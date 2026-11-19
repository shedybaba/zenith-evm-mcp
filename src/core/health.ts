import { formatGwei } from "viem";
import { LIMITS } from "./config.js";
import type { ZenithContext } from "./context.js";
import { checkReset, type ResetStatus } from "./reset.js";

export async function networkInfo(ctx: ZenithContext) {
  const [chainId, block, gasPrice, chain] = await Promise.all([
    ctx.client.getChainId(),
    ctx.client.getBlock({ blockTag: "latest" }),
    ctx.client.getGasPrice(),
    ctx.gateway.chain(),
  ]);
  const ageSeconds = Math.max(0, Math.round(Date.now() / 1000 - Number(block.timestamp)));
  return {
    network: {
      name: ctx.network.name,
      chainId,
      nativeCurrency: { symbol: ctx.network.nativeSymbol, decimals: ctx.network.nativeDecimals },
      rpcUrl: ctx.network.rpcUrl,
      explorerUrl: ctx.network.explorerUrl,
      explorerApiUrl: ctx.network.explorerApiUrl,
      faucetUrl: ctx.network.faucetUrl,
      gatewayApiUrl: `${ctx.network.gatewayApiUrl}/v1`,
      synchronizerUrl: ctx.network.synchronizerUrl,
      docsUrl: ctx.network.docsUrl,
    },
    latestBlock: {
      number: block.number,
      hash: block.hash,
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      ageSeconds,
      transactions: block.transactions.length,
    },
    gasPrice: { wei: gasPrice, gwei: formatGwei(gasPrice) },
    gateway: {
      contract: chain.gatewayAddress,
      party: chain.gatewayParty,
      protocolNamespace: chain.namespace,
      deploymentId: chain.deploymentId,
      genesisHash: chain.genesisHash,
      nativeInstrument: chain.native.instrument,
      minExecuteBeforeSeconds: chain.offers.minExecuteBeforeSeconds,
    },
    blockProduction:
      "Blocks are produced on demand: a block only when there are transactions (rounds of about 2 seconds). An unchanged block number is not a stall. Each EVM block settles as one Canton transaction, so a receipt means the transaction is final (no reorgs).",
    limits: LIMITS,
  };
}

export type HealthVerdict = "healthy" | "idle" | "degraded" | "possible-reset";

interface ComponentStatus {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const start = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - start };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ms: Date.now() - start };
  }
}

/** One verdict for "is the network OK?", aware that an idle chain produces no blocks. */
export async function healthCheck(ctx: ZenithContext) {
  const [rpc, explorer, gateway, faucet, reset] = await Promise.all([
    timed(() => ctx.client.getBlock({ blockTag: "latest" })),
    timed(() => ctx.explorer.health()),
    timed(() => ctx.gateway.health()),
    timed(() => ctx.explorer.faucet()),
    timed(() => checkReset(ctx)),
  ]);

  const components: Record<string, ComponentStatus> = {};
  const problems: string[] = [];

  let blockAge: number | null = null;
  if (rpc.value) {
    blockAge = Math.max(0, Math.round(Date.now() / 1000 - Number(rpc.value.timestamp)));
    components.rpc = {
      ok: true,
      latencyMs: rpc.ms,
      detail: `latest block ${rpc.value.number}, ${blockAge}s old`,
    };
  } else {
    components.rpc = { ok: false, latencyMs: rpc.ms, detail: rpc.error ?? "unreachable" };
    problems.push("The public RPC did not answer.");
  }

  let producerFresh = false;
  if (gateway.value) {
    const g = gateway.value;
    producerFresh = g.producer === "up" && g.producerProgressSecondsAgo <= 60;
    const ok = g.ok && g.ready && g.synchronizer === "connected" && g.producer === "up";
    components.gateway = {
      ok,
      latencyMs: gateway.ms,
      detail: `core ${g.core}, ledger ${g.ledger}, producer ${g.producer} (progress ${g.producerProgressSecondsAgo}s ago), synchronizer ${g.synchronizer}`,
    };
    if (!ok) problems.push("Gateway reports a component that is not up.");
    if (g.producerProgressSecondsAgo > 120)
      problems.push(`The block producer last made progress ${g.producerProgressSecondsAgo}s ago.`);
  } else {
    components.gateway = {
      ok: false,
      latencyMs: gateway.ms,
      detail: gateway.error ?? "unreachable",
    };
    problems.push("The Gateway API did not answer.");
  }

  if (explorer.value) {
    const critical = ["database", "evm", "canton"];
    const services = explorer.value.services ?? {};
    const down = critical.filter((s) => services[s] && services[s]!.status !== "online");
    components.explorer = {
      ok: down.length === 0,
      latencyMs: explorer.ms,
      detail: Object.entries(services)
        .map(([name, s]) => `${name} ${s.status}`)
        .join(", "),
    };
    if (down.length) problems.push(`Explorer services offline: ${down.join(", ")}.`);
  } else {
    components.explorer = {
      ok: false,
      latencyMs: explorer.ms,
      detail: explorer.error ?? "unreachable",
    };
    problems.push("The explorer API did not answer.");
  }

  const f = faucet.value;
  const faucetInfo = f
    ? {
        enabled: f.enabled,
        amountPerClaim: f.zthAmount ? `${f.zthAmount} ZTH` : null,
        cooldown: f.cooldownLabel,
        rule: f.githubCreatedBefore
          ? `Claim with a GitHub sign-in on the faucet page; the account must have been created before ${f.githubCreatedBefore.slice(0, 10)}. ${f.githubMaxPerWindow ?? 1} claim per account per ${f.cooldownLabel}.`
          : "Claim on the faucet page.",
        url: ctx.network.faucetUrl,
      }
    : { enabled: false, error: faucet.error };

  const resetStatus: ResetStatus | undefined = reset.value;
  let verdict: HealthVerdict;
  let summary: string;
  if (resetStatus && resetStatus.status !== "unchanged") {
    verdict = "possible-reset";
    summary =
      "The testnet looks like it was reset. Stored inbox addresses, holdings and nonces from before are no longer valid.";
  } else if (problems.length) {
    verdict = "degraded";
    summary = problems.join(" ");
  } else if (blockAge !== null && blockAge > 60 && producerFresh) {
    verdict = "idle";
    summary = `No new block for ${blockAge}s, but the producer is alive: the chain is idle, not stalled (blocks are produced only when there are transactions).`;
  } else {
    verdict = "healthy";
    summary = "All components answer and the block producer is making progress.";
  }

  return {
    verdict,
    summary,
    components,
    faucet: faucetInfo,
    reset: resetStatus ?? { error: reset.error },
  };
}
