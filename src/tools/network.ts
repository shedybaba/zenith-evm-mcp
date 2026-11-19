import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZenithContext } from "../core/context.js";
import { healthCheck, networkInfo } from "../core/health.js";
import { guard, ok, READ_ONLY } from "./util.js";

export function registerNetworkTools(server: McpServer, ctx: ZenithContext) {
  server.registerTool(
    "zenith_network_info",
    {
      title: "Zenith network info",
      description:
        "Chain ID, endpoints (RPC, explorer, faucet, Gateway API, docs), latest block and its age, gas price, the Gateway deployment (contract, party, deployment ID, genesis hash) and the public RPC limits. Call this first when working with Zenith EVM.",
      annotations: READ_ONLY,
    },
    () =>
      guard(async () => {
        const info = await networkInfo(ctx);
        return ok(
          `${info.network.name} (chain ${info.network.chainId}): block ${info.latestBlock.number}, ${info.latestBlock.ageSeconds}s old; gas ${info.gasPrice.gwei} gwei.`,
          info,
        );
      }),
  );

  server.registerTool(
    "zenith_health",
    {
      title: "Zenith network health",
      description:
        "One verdict for whether Zenith is working: healthy, idle (no traffic but the block producer is alive; blocks are only made when there are transactions), degraded, or possible-reset (the testnet was reset, so stored inbox addresses and holdings are invalid). Checks the RPC, the explorer's services, the Gateway producer and synchronizer, and the faucet (amount, cooldown, GitHub-account rule).",
      annotations: READ_ONLY,
    },
    () =>
      guard(async () => {
        const h = await healthCheck(ctx);
        return ok(`Verdict: ${h.verdict.toUpperCase()}. ${h.summary}`, h);
      }),
  );
}
