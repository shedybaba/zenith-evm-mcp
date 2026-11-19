import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI } from "./abi.js";
import { DOC_LINKS, ZTH_QUANTUM_WEI } from "./config.js";
import type { ZenithContext } from "./context.js";
import { resolveInbox, type InboxResolution } from "./inbox.js";
import type { PartyCheck } from "./party.js";
import { checkReset, type ResetStatus } from "./reset.js";
import { RpcError } from "./rpc.js";
import { loadGatewayTokens, matchGatewayToken, type GatewayToken } from "./tokens.js";
import { AmountError, erc20BaseToCanton, parseDecimal, zthWeiToCanton } from "./units.js";

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
  docs?: string;
}

export interface PreflightInput {
  partyId: string;
  token: string;
  amount: string;
  amountUnit?: "token" | "base";
  from?: string;
}

export interface PreflightFacts {
  input: PreflightInput;
  party: PartyCheck;
  token: GatewayToken | null;
  /** True when the token is an ERC-20 address that is not in the Gateway registries. */
  unregisteredAddress: boolean;
  amountBase: bigint | null;
  amountError: string | null;
  inbox: InboxResolution | null;
  reset: ResetStatus | null;
  sender: {
    address: Address;
    isContract: boolean;
    nativeBalance: bigint;
    tokenBalance: bigint | null;
  } | null;
  gasPrice: bigint | null;
  dryRun: { ok: true; gas: bigint } | { ok: false; code: number | null; message: string } | null;
  transaction: { to: Address; value: bigint; data: Hex } | null;
}

/** -32003 refusals from the Zenith RPC name their reason; map them to fixes from the docs. */
export function explainRefusal(message: string): { reason: string; fix: string } {
  if (/standing acceptance/i.test(message)) {
    return {
      reason: "The recipient has no standing acceptance (transfer preapproval) for this token.",
      fix: "Ask the recipient to create a standing acceptance with the token's registry (for DevUSD and DevCC: Workflow 2/b, step 1), then send again.",
    };
  }
  if (/regist/i.test(message)) {
    return {
      reason: "The token is not registered with Gateway.",
      fix: "Only send tokens listed by gateway_tokens.",
    };
  }
  if (/10\^8|quant|multiple/i.test(message)) {
    return {
      reason: "The ZTH value is not a multiple of 10^8 wei.",
      fix: "Round the value down to a multiple of 100000000 wei.",
    };
  }
  return { reason: message, fix: "Fix the cause named in the message and send again." };
}

/** Pure rule evaluation: every rule from the Zenith "Before you send" checklist. */
export function evaluatePreflight(f: PreflightFacts) {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // 1. Recipient party ID.
  const partyErrors = f.party.issues.filter((i) => i.severity === "error");
  const partyWarnings = f.party.issues.filter((i) => i.severity === "warning");
  const protocol = partyErrors.find(
    (i) => i.code === "PROTOCOL_PARTY" || i.code === "GATEWAY_PARTY",
  );
  const format = partyErrors.filter((i) => i !== protocol);
  add({
    id: "party_id_complete",
    title: "Recipient is a full party ID (hint::1220<64 hex>)",
    status: format.length ? "fail" : partyWarnings.length ? "warn" : "pass",
    detail: format.length
      ? format.map((i) => i.message).join(" ")
      : partyWarnings.length
        ? partyWarnings.map((i) => i.message).join(" ")
        : `Party ${f.party.party}`,
    fix: format[0]?.fix,
    docs: DOC_LINKS.beforeYouSend,
  });
  add({
    id: "not_protocol_party",
    title: "Recipient is not a Zenith protocol party or the Gateway party",
    status: protocol ? "fail" : format.length ? "skip" : "pass",
    detail: protocol
      ? protocol.message
      : format.length
        ? "Skipped: the party ID is not valid."
        : "Not an m-/r-/b- protocol party and not the Gateway party.",
    fix: protocol?.fix,
    docs: DOC_LINKS.beforeYouSend,
  });

  // 2. Token registration.
  const t = f.token;
  add({
    id: "token_registered",
    title: "Token is registered with Gateway",
    status: t ? "pass" : "fail",
    detail: t
      ? `${t.key} (${t.kind}${t.evm.address ? `, ${t.evm.address}` : ""}) arrives on Canton as ${t.canton.symbol}.`
      : f.unregisteredAddress
        ? `${f.input.token} is not in /v1/registries. The RPC refuses a direct transfer of it to an inbox, and one sent from inside a contract call stays in the inbox for good.`
        : `No registered token matches "${f.input.token}".`,
    fix: t
      ? undefined
      : "Use gateway_tokens to list what Gateway can move. To register a new token, Zenith must approve it (see gateway_token_eligibility).",
    docs: DOC_LINKS.transferDirections,
  });
  if (t?.toCanton.recipientNeeds) {
    const proven = f.dryRun?.ok === true;
    add({
      id: "recipient_acceptance",
      title: "Recipient can receive this token",
      status: proven
        ? "pass"
        : f.dryRun && !f.dryRun.ok && /standing acceptance/i.test(f.dryRun.message)
          ? "fail"
          : "warn",
      detail: proven
        ? `The network accepted the dry run, so the recipient has ${t.toCanton.recipientNeeds}.`
        : `This token needs the recipient to have ${t.toCanton.recipientNeeds}. Without it the RPC refuses the transfer (-32003).`,
      fix: proven
        ? undefined
        : "Provide the sender address so the dry run can confirm it, or ask the recipient to set up the acceptance first.",
      docs: DOC_LINKS.workflows,
    });
  }

  // 3. Amount and units.
  if (!t) {
    add({
      id: "amount_valid",
      title: "Amount is a valid positive number",
      status: "skip",
      detail: "Skipped: the token is not registered.",
    });
  } else if (f.amountError || f.amountBase === null) {
    add({
      id: "amount_valid",
      title: "Amount is a valid positive number",
      status: "fail",
      detail: f.amountError ?? "No amount.",
      docs: DOC_LINKS.amounts,
    });
  } else if (f.amountBase <= 0n) {
    add({
      id: "amount_valid",
      title: "Amount is a valid positive number",
      status: "fail",
      detail: "Gateway only treats a non-zero amount as a deposit.",
      docs: DOC_LINKS.amounts,
    });
  } else {
    add({
      id: "amount_valid",
      title: "Amount is a valid positive number",
      status: "pass",
      detail: `${f.amountBase} base units.`,
    });
    if (t?.kind === "native") {
      const z = zthWeiToCanton(f.amountBase);
      add({
        id: "zth_quantum",
        title: "ZTH value is a multiple of 10^8 wei",
        status: z.exact ? "pass" : "fail",
        detail: z.exact
          ? `${formatEther(f.amountBase)} ZTH arrives as ${z.amount} wZTH.`
          : `${f.amountBase} wei is not a multiple of ${ZTH_QUANTUM_WEI}. The nearest sendable value is ${z.roundedDownWei} wei (${formatEther(z.roundedDownWei)} ZTH).`,
        fix: z.exact ? undefined : `Send ${formatEther(z.roundedDownWei)} ZTH instead.`,
        docs: DOC_LINKS.amounts,
      });
    }
  }

  // 4. Inbox.
  if (f.inbox?.inbox) {
    add({
      id: "inbox_matches_registry",
      title: "Inbox address agrees with the Gateway registry",
      status: f.inbox.apiMatches === false ? "fail" : f.inbox.apiMatches ? "pass" : "skip",
      detail:
        f.inbox.apiMatches === false
          ? "The Gateway contract and the registry API disagree on the inbox address."
          : f.inbox.apiMatches
            ? `inboxOf() and /v1/inboxes both give ${f.inbox.inbox}.`
            : "The registry only reveals an inbox once it is deployed.",
    });
    add({
      id: "recipient_known",
      title: "Gateway knows the recipient party",
      status: f.inbox.known === true ? "pass" : f.inbox.known === false ? "fail" : "warn",
      detail:
        f.inbox.known === true
          ? `${f.inbox.knownEvidence} Inbox ${f.inbox.inbox} (${f.inbox.deployed ? "deployed" : "deployed by the first deposit"}).`
          : f.inbox.notes.join(" ") || (f.inbox.knownEvidence ?? "Unknown."),
      fix:
        f.inbox.known === true
          ? undefined
          : "Confirm the full party ID with the recipient. If their party was just created, wait a minute and run the preflight again.",
      docs: DOC_LINKS.commonProblems,
    });
  }

  // 5. Sender, direct transfer and balances.
  if (f.sender) {
    add({
      id: "direct_transfer",
      title: "Sent directly from a wallet, not through a contract",
      status: f.sender.isContract ? "warn" : "pass",
      detail: f.sender.isContract
        ? "The sender is a contract (for example a smart wallet). The RPC only checks a transaction's own call; a transfer made inside a contract call is not refused, and an unregistered token sent that way stays in the inbox for good."
        : "The transaction is a plain transfer from the sender's own key, so the RPC checks it before it is accepted.",
      docs: DOC_LINKS.fromApplication,
    });
    if (f.amountBase !== null && t) {
      const gasCost = f.dryRun?.ok && f.gasPrice ? f.dryRun.gas * f.gasPrice : 0n;
      const needNative = (t.kind === "native" ? f.amountBase : 0n) + gasCost;
      const enoughNative = f.sender.nativeBalance >= needNative;
      const enoughToken = t.kind === "native" || (f.sender.tokenBalance ?? 0n) >= f.amountBase;
      add({
        id: "sender_balance",
        title: "Sender has enough balance",
        status: enoughNative && enoughToken ? "pass" : "fail",
        detail:
          `${formatEther(f.sender.nativeBalance)} ZTH available${gasCost ? `, ~${formatEther(gasCost)} ZTH gas` : ""}` +
          (t.kind === "native"
            ? "."
            : `; ${formatUnits(f.sender.tokenBalance ?? 0n, t.evm.decimals)} ${t.evm.symbol} available.`),
        fix:
          enoughNative && enoughToken
            ? undefined
            : "Top up the sender (ZTH for gas comes from the faucet).",
      });
    }
  } else {
    add({
      id: "direct_transfer",
      title: "Sent directly from a wallet, not through a contract",
      status: "skip",
      detail: "No sender given.",
    });
  }

  // 6. Live dry run.
  if (f.dryRun) {
    const refusal = f.dryRun.ok ? null : explainRefusal(f.dryRun.message);
    add({
      id: "network_dry_run",
      title: "The Zenith RPC accepts this exact transaction (eth_estimateGas)",
      status: f.dryRun.ok ? "pass" : "fail",
      detail: f.dryRun.ok
        ? `Accepted; estimated gas ${f.dryRun.gas}.`
        : `Refused${f.dryRun.code !== null ? ` (${f.dryRun.code})` : ""}: ${f.dryRun.message}${refusal && refusal.reason !== f.dryRun.message ? ` → ${refusal.reason}` : ""}`,
      fix: refusal?.fix,
      docs: DOC_LINKS.commonProblems,
    });
  } else {
    add({
      id: "network_dry_run",
      title: "The Zenith RPC accepts this exact transaction (eth_estimateGas)",
      status: "skip",
      detail: f.transaction
        ? "Give the sender address to run the dry run. Nothing is ever sent."
        : "Skipped because an earlier check failed.",
    });
  }

  // 7. Testnet reset.
  if (f.reset) {
    add({
      id: "no_reset",
      title: "No testnet reset since this tool's baseline",
      status: f.reset.status === "unchanged" ? "pass" : "warn",
      detail:
        f.reset.status === "unchanged"
          ? "Gateway deployment unchanged."
          : `${f.reset.changes.join("; ")}. ${f.reset.advice}`,
    });
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  const verdict = failed.length ? "blocked" : warned.length ? "caution" : "ready";

  let arrives: { amount: string; symbol: string } | null = null;
  if (t && f.amountBase !== null && f.amountBase > 0n) {
    arrives =
      t.kind === "native"
        ? { amount: zthWeiToCanton(f.amountBase).amount, symbol: t.canton.symbol }
        : { amount: erc20BaseToCanton(f.amountBase).amount, symbol: t.canton.symbol };
  }

  return {
    verdict,
    summary:
      verdict === "blocked"
        ? `BLOCKED: do not send. Failed: ${failed.map((c) => `"${c.title}"`).join(", ")}.`
        : verdict === "caution"
          ? `CAUTION: no check failed, but review: ${warned.map((c) => `"${c.title}"`).join(", ")}.`
          : f.dryRun?.ok
            ? "READY: every check passed and the network accepted a dry run of the exact transaction."
            : "READY: every check passed. Give the sender address to also dry-run the exact transaction.",
    checks,
    recipient: { party: f.party.party, inbox: f.inbox?.inbox ?? null },
    token: t
      ? { key: t.key, evmAddress: t.evm.address, evmSymbol: t.evm.symbol, decimals: t.evm.decimals }
      : null,
    arrivesOnCanton: arrives,
    transaction: verdict === "blocked" ? null : f.transaction,
    afterSending:
      verdict === "blocked"
        ? null
        : "Wait for the receipt with a time limit (about 2 minutes). If none arrives, call gateway_deposit_status with the hash: a held deposit is evicted after about 10 minutes together with later transactions from the same address.",
  };
}

/** Gathers every fact the checklist needs. Never sends anything. */
export async function gatherPreflightFacts(
  ctx: ZenithContext,
  input: PreflightInput,
): Promise<PreflightFacts> {
  const [tokens, reset] = await Promise.all([
    loadGatewayTokens(ctx),
    checkReset(ctx).catch(() => null),
  ]);
  const token = matchGatewayToken(tokens, input.token);
  const unregisteredAddress = !token && isAddress(input.token.trim(), { strict: false });

  let amountBase: bigint | null = null;
  let amountError: string | null = null;
  if (token) {
    try {
      amountBase =
        input.amountUnit === "base"
          ? BigInt(input.amount.trim())
          : parseDecimal(input.amount, token.evm.decimals);
    } catch (err) {
      amountError =
        err instanceof AmountError ? err.message : `"${input.amount}" is not a valid amount`;
    }
  }

  const inbox = await resolveInbox(ctx, input.partyId);
  const facts: PreflightFacts = {
    input,
    party: inbox.party,
    token,
    unregisteredAddress,
    amountBase,
    amountError,
    inbox: inbox.inbox ? inbox : null,
    reset,
    sender: null,
    gasPrice: null,
    dryRun: null,
    transaction: null,
  };

  // Built even for an unaligned ZTH value, so the dry run shows the network's own refusal; a blocked
  // verdict never returns the transaction.
  if (token && inbox.inbox && amountBase !== null && amountBase > 0n) {
    facts.transaction =
      token.kind === "native"
        ? { to: inbox.inbox, value: amountBase, data: "0x" }
        : {
            to: token.evm.address!,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [inbox.inbox, amountBase],
            }),
          };
  }

  if (input.from) {
    if (!isAddress(input.from, { strict: false }))
      throw new Error(`"${input.from}" is not an EVM address`);
    const from = getAddress(input.from);
    const [code, nativeBalance, tokenBalance, gasPrice] = await Promise.all([
      ctx.client.getCode({ address: from }),
      ctx.client.getBalance({ address: from }),
      token?.evm.address
        ? ctx.client
            .readContract({
              address: token.evm.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [from],
            })
            .catch(() => null)
        : Promise.resolve(null),
      ctx.client.getGasPrice(),
    ]);
    facts.sender = {
      address: from,
      isContract: Boolean(code && code !== "0x"),
      nativeBalance,
      tokenBalance,
    };
    facts.gasPrice = gasPrice;

    if (facts.transaction && facts.party.valid) {
      try {
        const gas = await ctx.rpc.request<Hex>("eth_estimateGas", [
          {
            from,
            to: facts.transaction.to,
            value: `0x${facts.transaction.value.toString(16)}`,
            data: facts.transaction.data,
          },
        ]);
        facts.dryRun = { ok: true, gas: BigInt(gas) };
      } catch (err) {
        facts.dryRun =
          err instanceof RpcError
            ? { ok: false, code: err.code, message: err.message }
            : { ok: false, code: null, message: (err as Error).message };
      }
    }
  }
  return facts;
}

export async function gatewayPreflight(ctx: ZenithContext, input: PreflightInput) {
  return evaluatePreflight(await gatherPreflightFacts(ctx, input));
}
