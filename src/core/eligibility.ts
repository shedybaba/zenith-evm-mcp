import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type StateOverride,
} from "viem";
import { ERC20_ABI } from "./abi.js";
import { readErc20, readProxySlots } from "./account.js";
import { matchSelectors, OPCODES, scanOpcodes } from "./bytecode.js";
import { DOC_LINKS } from "./config.js";
import type { ZenithContext } from "./context.js";
import type { Check } from "./preflight.js";
import { TRANSFER_PROBE_ABI, TRANSFER_PROBE_RUNTIME } from "./probe.generated.js";
import { loadGatewayTokens } from "./tokens.js";
import { cantonScaledSymbol, oneTokenOnCanton } from "./units.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** A fixed recipient with no code and no history, used only inside simulations. */
const PROBE_RECIPIENT = getAddress(
  `0x${keccak256(toHex("zenith-evm-mcp/probe-recipient")).slice(-40)}`,
);
const ERC1820_REGISTRY = "1820a4b7618bde71dce8cdc73aab6c95905fad24";

/** Function families that Zenith's registration criteria rule out, or that need a human look. */
const RISKY = {
  blocklist: {
    status: "fail" as const,
    title: "No blocklist",
    sigs: [
      "blacklist(address)",
      "addBlackList(address)",
      "addToBlacklist(address)",
      "isBlacklisted(address)",
      "isBlackListed(address)",
      "isBlocklisted(address)",
      "freeze(address)",
      "freezeAccount(address,bool)",
      "blockAccount(address)",
    ],
  },
  fees: {
    status: "fail" as const,
    title: "No transfer fee or reflection",
    sigs: [
      "setFee(uint256)",
      "setTaxFeePercent(uint256)",
      "taxFee()",
      "excludeFromFee(address)",
      "isExcludedFromFee(address)",
      "reflectionFromToken(uint256,bool)",
      "tokenFromReflection(uint256)",
      "setMaxTxAmount(uint256)",
      "setSwapAndLiquifyEnabled(bool)",
    ],
  },
  rebase: {
    status: "fail" as const,
    title: "No rebasing",
    sigs: [
      "rebase()",
      "rebase(uint256,int256)",
      "sharesOf(address)",
      "getSharesByPooledEth(uint256)",
      "scaledBalanceOf(address)",
      "gonsPerFragment()",
    ],
  },
  adminBalances: {
    status: "fail" as const,
    title: "No admin control over balances or code",
    sigs: [
      "burn(address,uint256)",
      "setBalance(address,uint256)",
      "forceTransfer(address,address,uint256)",
      "adminTransfer(address,address,uint256)",
      "upgradeTo(address)",
      "upgradeToAndCall(address,bytes)",
    ],
  },
  hooks: {
    status: "warn" as const,
    title: "No transfer hooks",
    sigs: [
      "send(address,uint256,bytes)",
      "operatorSend(address,address,uint256,bytes,bytes)",
      "authorizeOperator(address)",
      "transferAndCall(address,uint256)",
      "transferAndCall(address,uint256,bytes)",
      "transferFromAndCall(address,address,uint256)",
    ],
  },
  pause: {
    status: "warn" as const,
    title: "No pause switch",
    sigs: ["pause()", "unpause()", "paused()"],
  },
  mint: {
    status: "warn" as const,
    title: "Supply controls",
    sigs: ["mint(address,uint256)", "mint(uint256)"],
  },
};

async function findHolder(
  ctx: ZenithContext,
  token: Address,
): Promise<{ holder: Address; balance: bigint } | null> {
  const logs = await ctx.explorer
    .getLogs({
      address: token,
      fromBlock: 0,
      toBlock: "latest",
      topic0: TRANSFER_TOPIC,
      offset: 1000,
    })
    .catch(() => []);
  const seen = new Set<string>();
  const candidates: Address[] = [];
  for (const l of [...logs].reverse()) {
    for (const t of [l.topics[2], l.topics[1]]) {
      if (!t) continue;
      const a = getAddress(`0x${t.slice(-40)}`);
      if (a === "0x0000000000000000000000000000000000000000" || seen.has(a)) continue;
      seen.add(a);
      candidates.push(a);
    }
    if (candidates.length >= 25) break;
  }
  let best: { holder: Address; balance: bigint; eoa: boolean } | null = null;
  for (const holder of candidates) {
    const [balance, code] = await Promise.all([
      ctx.client
        .readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [holder] })
        .catch(() => 0n),
      ctx.client.getCode({ address: holder }).catch(() => undefined),
    ]);
    const eoa = !code || code === "0x";
    if (
      balance > 0n &&
      (!best || (eoa && !best.eoa) || (eoa === best.eoa && balance > best.balance))
    )
      best = { holder, balance, eoa };
    if (best?.eoa && best.balance > 0n && candidates.indexOf(holder) > 8) break;
  }
  return best ? { holder: best.holder, balance: best.balance } : null;
}

/**
 * Simulates `holder` transferring `amount` of `token` to a fresh address and reports both balance changes.
 * `extraOverrides` lets tests run the probe against a token that only exists inside the simulation.
 */
export async function simulateTransfer(
  ctx: ZenithContext,
  token: Address,
  holder: Address,
  amount: bigint,
  extraOverrides: StateOverride = [],
) {
  const data = encodeFunctionData({
    abi: TRANSFER_PROBE_ABI,
    functionName: "probe",
    args: [token, PROBE_RECIPIENT, amount],
  });
  const res = await ctx.client.call({
    to: holder,
    data,
    stateOverride: [{ address: holder, code: TRANSFER_PROBE_RUNTIME as Hex }, ...extraOverrides],
  });
  const [
    callSucceeded,
    returnedTrue,
    senderBefore,
    senderAfter,
    recipientBefore,
    recipientAfter,
    revertData,
  ] = decodeFunctionResult({
    abi: TRANSFER_PROBE_ABI,
    functionName: "probe",
    data: res.data!,
  }) as readonly [boolean, boolean, bigint, bigint, bigint, bigint, Hex];
  return {
    amount,
    callSucceeded,
    returnedTrue,
    senderDelta: senderBefore - senderAfter,
    recipientDelta: recipientAfter - recipientBefore,
    revertData: revertData === "0x" ? null : revertData,
  };
}

/**
 * Pre-screens an ERC-20 against the registration criteria in the Zenith docs: a plain ERC-20 whose
 * transfer moves exactly the amount (no fee, burn, reflection, rebase, hook or blocklist), not upgradeable,
 * with verified source so Zenith can rebuild its bytecode. Zenith makes the final decision.
 */
export async function tokenEligibility(ctx: ZenithContext, input: string) {
  if (!isAddress(input, { strict: false })) throw new Error(`"${input}" is not an EVM address`);
  const token = getAddress(input);
  const checks: Check[] = [];
  const code = await ctx.client.getCode({ address: token });
  if (!code || code === "0x") {
    return {
      token: { address: token },
      verdict: "not-eligible" as const,
      summary: "No contract at this address.",
      checks: [
        {
          id: "is_contract",
          title: "Contract exists",
          status: "fail" as const,
          detail: "No code at this address on Zenith testnet.",
        },
      ],
    };
  }

  const [meta, source, creation, proxy, tokens] = await Promise.all([
    readErc20(ctx, token),
    ctx.explorer.getSourceInfo(token).catch(() => null),
    ctx.explorer.getContractCreation([token]).catch(() => []),
    readProxySlots(ctx, token),
    loadGatewayTokens(ctx).catch(() => []),
  ]);

  const registered = tokens.find((t) => t.evm.address?.toLowerCase() === token.toLowerCase());
  if (registered) {
    checks.push({
      id: "registration_status",
      title: "Registration status",
      status: "pass",
      detail: `Already registered with Gateway as ${registered.key} (${registered.kind}).`,
    });
  }

  checks.push({
    id: "erc20_interface",
    title: "Standard ERC-20 interface",
    status: meta ? "pass" : "fail",
    detail: meta
      ? `${meta.name ?? "(no name)"} (${meta.symbol}), ${meta.decimals} decimals, supply ${meta.totalSupply}.`
      : "symbol(), decimals() or totalSupply() did not answer like an ERC-20.",
  });

  checks.push({
    id: "verified_source",
    title: "Source verified on the explorer",
    status: source?.verified ? "pass" : "fail",
    detail: source?.verified
      ? `Verified as ${source.contractName} with ${source.compilerVersion}.`
      : "Not verified. Zenith needs the compiler's standard-JSON input so it can rebuild the runtime bytecode exactly.",
    fix: source?.verified
      ? undefined
      : "Verify it with zenith_verify_contract (standard-JSON input).",
    docs: DOC_LINKS.registerToken,
  });

  const created = creation[0];
  checks.push({
    id: "creation_tx",
    title: "Deployment transaction known",
    status: created ? "pass" : "warn",
    detail: created
      ? `Created by ${created.contractCreator} in ${created.txHash}.`
      : "The explorer has no creation record; send Zenith the deployment transaction or constructor arguments.",
  });

  const isProxy = proxy.isProxy || source?.proxy;
  checks.push({
    id: "not_upgradeable",
    title: "Not a proxy / not upgradeable",
    status: isProxy ? "fail" : "pass",
    detail: isProxy
      ? `Proxy detected (implementation ${proxy.implementation ?? source?.implementation ?? "unknown"}). Zenith refuses upgradeable tokens.`
      : "No EIP-1967, EIP-1822 or beacon proxy slots are set.",
  });

  const ops = scanOpcodes(code);
  const risky: string[] = [];
  if (ops.has(OPCODES.DELEGATECALL))
    risky.push("DELEGATECALL (code can run other contracts' logic)");
  if (ops.has(OPCODES.SELFDESTRUCT)) risky.push("SELFDESTRUCT");
  checks.push({
    id: "no_code_indirection",
    title: "No delegatecall or selfdestruct",
    status: risky.length ? "warn" : "pass",
    detail: risky.length
      ? `Bytecode contains ${risky.join(" and ")}.`
      : "Neither opcode is present.",
  });

  for (const [id, family] of Object.entries(RISKY)) {
    const found = matchSelectors(code, family.sigs);
    const erc777 = id === "hooks" && code.toLowerCase().includes(ERC1820_REGISTRY);
    if (erc777) found.push("ERC-1820 registry address (ERC-777 hooks)");
    checks.push({
      id: `functions_${id}`,
      title: family.title,
      status: found.length ? family.status : "pass",
      detail: found.length
        ? `Found: ${found.join(", ")} (matched by function selector).`
        : "No matching functions found in the bytecode.",
    });
  }

  // Live simulation: move tokens from a real holder to a fresh address and compare balances.
  let simulation: unknown = null;
  if (meta) {
    const holder = await findHolder(ctx, token);
    if (!holder) {
      checks.push({
        id: "exact_transfer",
        title: "Transfer moves exactly the amount (simulated)",
        status: "skip",
        detail: "No holder with a balance was found to simulate from.",
      });
    } else {
      const amounts = [...new Set([holder.balance / 100n || 1n, holder.balance / 2n || 1n])];
      const runs = [];
      for (const amount of amounts)
        runs.push(await simulateTransfer(ctx, token, holder.holder, amount));
      simulation = { holder: holder.holder, recipient: PROBE_RECIPIENT, runs };
      const bad = runs.find(
        (r) =>
          !r.callSucceeded ||
          !r.returnedTrue ||
          r.senderDelta !== r.amount ||
          r.recipientDelta !== r.amount,
      );
      const fmt = (v: bigint) => `${formatUnits(v, meta.decimals)} ${meta.symbol}`;
      checks.push({
        id: "exact_transfer",
        title: "Transfer moves exactly the amount (simulated)",
        status: !bad ? "pass" : !bad.callSucceeded ? "warn" : "fail",
        detail: !bad
          ? `Simulated ${runs.map((r) => fmt(r.amount)).join(" and ")} from ${holder.holder}: sender and recipient balances moved by exactly the amount.`
          : !bad.callSucceeded
            ? `The simulated transfer of ${fmt(bad.amount)} reverted (it may be paused, restricted or blocklisted).`
            : !bad.returnedTrue
              ? "transfer() returned false."
              : `Sending ${fmt(bad.amount)} took ${fmt(bad.senderDelta)} from the sender but gave the recipient ${fmt(bad.recipientDelta)}: a fee, burn or reflection.`,
        docs: DOC_LINKS.registerToken,
      });
    }
  }

  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const verdict = registered
    ? ("already-registered" as const)
    : fails.length
      ? ("not-eligible" as const)
      : warns.length
        ? ("needs-review" as const)
        : ("likely-eligible" as const);
  const decimals = meta?.decimals ?? 18;

  return {
    token: {
      address: token,
      name: meta?.name ?? null,
      symbol: meta?.symbol ?? null,
      decimals,
      cantonSymbol: meta ? cantonScaledSymbol(meta.symbol, decimals) : null,
      oneTokenOnCanton: oneTokenOnCanton(decimals),
    },
    verdict,
    summary:
      verdict === "already-registered"
        ? "This token is already registered with Gateway."
        : verdict === "not-eligible"
          ? `Not eligible. Failed: ${fails.map((c) => `"${c.title}"`).join(", ")}.`
          : verdict === "needs-review"
            ? `No hard blockers found. Review: ${warns.map((c) => `"${c.title}"`).join(", ")}.`
            : "Looks like a plain, non-upgradeable ERC-20 that moves exactly the amount.",
    checks,
    simulation,
    registrationRequest:
      verdict === "likely-eligible" || verdict === "needs-review"
        ? {
            sendTo: "partners@zenith.network",
            include: [
              `Token address on Zenith testnet: ${token}`,
              "Verified source as the compiler's standard-JSON input (solc --standard-json)",
              created
                ? `Deployment transaction: ${created.txHash}`
                : "Deployment transaction or constructor arguments",
            ],
            afterApproval:
              "File a registrar provisioning request (POST /v1/provisioning-requests with kind registrar) and tell Zenith it is waiting.",
            note: "On the public testnet the answer is no by default; registration is Zenith's decision.",
          }
        : null,
    disclaimer:
      "A pre-screen based on bytecode, storage and a simulated transfer. It cannot prove the absence of every restriction; Zenith decides.",
  };
}
