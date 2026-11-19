import { formatEther, formatGwei, getAddress, type Address, type Hex } from "viem";
import { decodeCall, decodeLog, looksLikeGatewayInbox } from "./abi.js";
import type { ZenithContext } from "./context.js";
import { abisFor } from "./decode.js";

const isHash = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);

/**
 * Everything about one transaction: receipt, decoded call and events, Gateway involvement,
 * and the Canton update that settled it (Zenith's "dual transaction identity").
 */
export async function traceTransaction(
  ctx: ZenithContext,
  hash: string,
  opts: { canton?: boolean } = {},
) {
  if (!isHash(hash)) throw new Error(`"${hash}" is not a transaction hash`);
  const h = hash as Hex;
  const [tx, receipt] = await Promise.all([
    ctx.client.getTransaction({ hash: h }).catch(() => null),
    ctx.client.getTransactionReceipt({ hash: h }).catch(() => null),
  ]);

  if (!receipt) {
    const pending = await ctx.gateway.pendingEvm(h).catch(() => null);
    return {
      hash: h,
      found: Boolean(tx),
      mined: false as const,
      gatewayPending: pending,
      explanation:
        pending && pending.state !== "unknown"
          ? `Gateway is holding this transaction (${pending.state}${pending.reason ? `: ${pending.reason}` : ""}). Use gateway_deposit_status for next steps.`
          : tx
            ? "Submitted but not mined yet. Blocks are built in rounds of about 2 seconds."
            : "Not known to the RPC. It may never have been submitted, may have been refused at submission, or was evicted by Gateway.",
    };
  }

  const block = await ctx.client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  const to = receipt.to ? getAddress(receipt.to) : null;
  const toCode = to ? await ctx.client.getCode({ address: to }).catch(() => undefined) : undefined;

  const call = tx && tx.input !== "0x" ? decodeCall(tx.input, await abisFor(ctx, to)) : null;

  const abiCache = new Map<string, Awaited<ReturnType<typeof abisFor>>>();
  const events = [];
  for (const log of receipt.logs) {
    const key = log.address.toLowerCase();
    if (!abiCache.has(key)) abiCache.set(key, await abisFor(ctx, getAddress(log.address)));
    events.push(
      decodeLog(
        {
          address: getAddress(log.address),
          topics: log.topics as Hex[],
          data: log.data,
          logIndex: log.logIndex,
        },
        abiCache.get(key)!,
      ),
    );
  }

  // Gateway involvement: a deposit to an inbox, or Gateway's own events in this transaction.
  let depositTo: Address | null = null;
  if (to && looksLikeGatewayInbox(toCode)) depositTo = to;
  if (!depositTo && call?.functionName === "transfer" && typeof call.args[0] === "string") {
    const recipient = getAddress(call.args[0] as string);
    const code = await ctx.client.getCode({ address: recipient }).catch(() => undefined);
    if (looksLikeGatewayInbox(code)) depositTo = recipient;
  }
  const gatewayEvents = events.filter((e) => e.source === "gateway" && e.event);
  const pending = depositTo ? await ctx.gateway.pendingEvm(h).catch(() => null) : null;

  const canton =
    opts.canton === false
      ? null
      : await ctx.explorer.findCantonLink(h, receipt.blockNumber).catch(() => null);
  const settlementMs =
    canton?.evmExecutedAt && canton.cantonFinalizedAt
      ? Math.max(0, Date.parse(canton.cantonFinalizedAt) - Date.parse(canton.evmExecutedAt))
      : null;

  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  return {
    hash: h,
    found: true,
    mined: true as const,
    status: receipt.status,
    final: true,
    finalityNote:
      "Zenith EVM blocks are final once Canton commits them: no confirmations to wait for, no reorgs.",
    block: {
      number: receipt.blockNumber,
      timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    },
    from: getAddress(receipt.from),
    to,
    contractCreated: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
    value: tx ? { wei: tx.value, zth: formatEther(tx.value) } : null,
    nonce: tx?.nonce ?? null,
    gas: {
      used: receipt.gasUsed,
      priceGwei: formatGwei(receipt.effectiveGasPrice),
      feeZth: formatEther(fee),
    },
    call,
    events,
    gateway:
      depositTo || gatewayEvents.length
        ? {
            depositToInbox: depositTo,
            events: gatewayEvents.map((e) => ({
              event: e.event,
              meaning: e.meaning,
              args: e.args,
            })),
            pending,
          }
        : null,
    canton: canton
      ? {
          updateId: canton.cantonUpdateId,
          commandId: canton.cantonCommandId,
          template: canton.cantonTemplate,
          status: canton.status,
          participantsConfirmed: canton.participantsConfirmed,
          participantsTotal: canton.participantsTotal,
          finalizedAt: canton.cantonFinalizedAt,
          settlementMs,
        }
      : opts.canton === false
        ? null
        : { note: "No Canton link found in the explorer index for this transaction yet." },
    explorer: ctx.explorer.txUrl(h),
  };
}
