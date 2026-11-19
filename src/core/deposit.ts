import { getAddress, type Address, type Hex } from "viem";
import { decodeCall, decodeLog, ERC20_ABI, GATEWAY_ABI, looksLikeGatewayInbox } from "./abi.js";
import { DOC_LINKS } from "./config.js";
import type { ZenithContext } from "./context.js";
import type { PendingState } from "./gateway.js";

const COLLECTION_EVENTS = new Set(["Collected", "NativeCollected"]);

export type DepositStage =
  | "credited"
  | "mined-awaiting-inbox"
  | "mined-no-collection-yet"
  | "mined-not-a-deposit"
  | "mined-reverted"
  | "held"
  | "evicted"
  | "submitted"
  | "unknown";

/**
 * Tracks a Zenith EVM → Canton deposit through Gateway: held, evicted, mined, waiting for the inbox,
 * or credited (a Collected/NativeCollected event for the inbox). Gives the exact next step.
 */
export async function depositStatus(
  ctx: ZenithContext,
  hash: string,
  opts: { from?: string } = {},
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`"${hash}" is not a transaction hash`);
  const h = hash as Hex;
  const [pending, tx, receipt] = await Promise.all([
    ctx.gateway.pendingEvm(h).catch(() => null as PendingState | null),
    ctx.client.getTransaction({ hash: h }).catch(() => null),
    ctx.client.getTransactionReceipt({ hash: h }).catch(() => null),
  ]);

  const nextSteps: string[] = [];
  let stage: DepositStage = "unknown";
  let explanation = "";
  let inbox: Address | null = null;
  let collection: unknown = null;

  if (receipt) {
    // Work out which inbox (if any) this transaction paid.
    const to = receipt.to ? getAddress(receipt.to) : null;
    const call =
      tx?.input && tx.input !== "0x"
        ? decodeCall(tx.input, [{ abi: ERC20_ABI, source: "erc20" }])
        : null;
    const candidate = call?.functionName === "transfer" ? getAddress(call.args[0] as string) : to;
    const code = candidate
      ? await ctx.client.getCode({ address: candidate }).catch(() => undefined)
      : undefined;
    if (candidate && looksLikeGatewayInbox(code)) inbox = candidate;
    const isZthToUndeployed = Boolean(
      candidate && candidate === to && tx && tx.value > 0n && (!code || code === "0x"),
    );

    if (receipt.status === "reverted") {
      stage = "mined-reverted";
      explanation =
        "The transaction reverted, so nothing moved. A Gateway inbox reverts ZTH that is not a multiple of 10^8 wei (NotWholeQuanta).";
      nextSteps.push(
        "Decode the revert with zenith_get_transaction, fix the cause, and send again.",
      );
    } else if (inbox || isZthToUndeployed) {
      const target = inbox ?? candidate!;
      const from = receipt.blockNumber;
      const logs = await ctx.client
        .getLogs({ address: ctx.network.gatewayAddress, fromBlock: from, toBlock: from + 20n })
        .catch(() => []);
      const hit = logs
        .map((l) => ({
          log: l,
          d: decodeLog(
            { address: getAddress(l.address), topics: l.topics as Hex[], data: l.data },
            [{ abi: GATEWAY_ABI, source: "gateway" }],
          ),
        }))
        .find(
          ({ d }) =>
            d.event &&
            COLLECTION_EVENTS.has(d.event) &&
            String(d.args?.inbox ?? "").toLowerCase() === target.toLowerCase(),
        );
      if (hit) {
        stage = "credited";
        explanation = `Gateway collected the deposit from inbox ${target} in block ${hit.log.blockNumber} and credited it on Canton.`;
        collection = {
          event: hit.d.event,
          block: hit.log.blockNumber,
          transactionHash: hit.log.transactionHash,
          args: hit.d.args,
        };
      } else if (pending?.state === "inbox-not-deployed" || isZthToUndeployed) {
        stage = "mined-awaiting-inbox";
        explanation =
          "Mined. The ZTH waits at an inbox that is not deployed yet; Gateway deploys it and then delivers the value as wZTH, which takes seconds to minutes.";
        nextSteps.push("Do not send it again. Check back in a few minutes.");
        nextSteps.push(
          "If the party ID was mistyped, the value is never delivered: confirm the full party ID with the recipient.",
        );
      } else {
        stage = "mined-no-collection-yet";
        explanation =
          "Mined to a Gateway inbox, but no collection event was found in the next 20 blocks yet.";
        nextSteps.push(
          "Credits normally come within a block or two. If nothing arrives after a few minutes, contact Zenith with the hash, the recipient party ID and the time in UTC.",
        );
      }
    } else {
      stage = "mined-not-a-deposit";
      explanation = "Mined, but it did not pay a Gateway inbox, so it is not a Gateway deposit.";
    }
  } else if (pending?.state === "held") {
    stage = "held";
    explanation = `Gateway is holding this deposit${pending.reason ? ` (${pending.reason})` : ""}, usually because the recipient's participant has not confirmed yet. It is not mined, so nothing has moved.`;
    nextSteps.push(
      `Do not send it again while it is held.${pending.nextAttempt ? ` Next attempt: ${pending.nextAttempt}.` : ""}${pending.evictAt ? ` Earliest eviction: ${pending.evictAt}.` : ""}`,
    );
    nextSteps.push(
      "Later transactions from the same address wait behind it and are evicted with it.",
    );
  } else if (pending?.state === "evicted") {
    stage = "evicted";
    explanation =
      "Gateway evicted this deposit (with any later transactions from the same address) because it could not be delivered in time. Nothing was mined; your tokens and gas were not spent.";
    const sender = opts.from ?? tx?.from;
    if (sender) {
      const nonce = await ctx.client
        .getTransactionCount({ address: getAddress(sender) })
        .catch(() => null);
      nextSteps.push(
        `Once the recipient's participant is online, send the same transfer again at nonce ${nonce ?? "<the evicted transaction's nonce>"}, then each later transaction in nonce order.`,
      );
    } else {
      nextSteps.push(
        "Pass the sender address to get the nonce to resend at. Resend the same transfer at that nonce, then later transactions in order.",
      );
    }
  } else if (tx) {
    stage = "submitted";
    explanation =
      "Submitted and waiting to be included. Blocks are built in rounds of about 2 seconds.";
  } else {
    stage = "unknown";
    explanation =
      "Gateway holds nothing for this hash and the RPC does not know it. It was never submitted, was refused at submission (the RPC refuses undeliverable deposits with -32003), or was evicted long ago.";
    nextSteps.push("Check the hash, then run gateway_preflight before sending again.");
  }

  return {
    hash: h,
    stage,
    explanation,
    nextSteps,
    inbox,
    gatewayPending: pending,
    collection,
    receipt: receipt
      ? { status: receipt.status, block: receipt.blockNumber, from: receipt.from, to: receipt.to }
      : null,
    docs: DOC_LINKS.commonProblems,
    explorer: ctx.explorer.txUrl(h),
  };
}
