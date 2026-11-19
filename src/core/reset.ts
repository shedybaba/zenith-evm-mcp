import type { Hex } from "viem";
import { BASELINE } from "./config.js";
import type { ZenithContext } from "./context.js";

export interface ResetStatus {
  status: "unchanged" | "reset-since-release" | "reset-this-session";
  current: { deploymentId: Hex; genesisHash: Hex };
  baseline: { deploymentId: Hex; genesisHash: Hex; validatedOn: string };
  changes: string[];
  advice: string | null;
}

/**
 * Detects testnet resets. A reset changes the Gateway deployment (and usually the synchronizer ID);
 * inbox addresses, holdings and nonces from before the reset are no longer valid.
 */
export async function checkReset(ctx: ZenithContext): Promise<ResetStatus> {
  const chain = await ctx.gateway.chain();
  const current = { deploymentId: chain.deploymentId, genesisHash: chain.genesisHash };
  ctx.session.firstSeenDeploymentId ??= chain.deploymentId;

  const changes: string[] = [];
  if (current.deploymentId !== BASELINE.deploymentId)
    changes.push("Gateway deployment ID differs from the one this release was validated against");
  if (current.genesisHash !== BASELINE.genesisHash)
    changes.push("EVM genesis hash differs from the one this release was validated against");

  let status: ResetStatus["status"] = "unchanged";
  if (ctx.session.firstSeenDeploymentId !== current.deploymentId) {
    status = "reset-this-session";
    changes.unshift("Gateway deployment ID changed during this session");
  } else if (changes.length) {
    status = "reset-since-release";
  }

  return {
    status,
    current,
    baseline: {
      deploymentId: BASELINE.deploymentId,
      genesisHash: BASELINE.genesisHash,
      validatedOn: BASELINE.validatedOn,
    },
    changes,
    advice:
      status === "unchanged"
        ? null
        : "The testnet was most likely reset. Look up every stored inbox address again with inboxOf (tokens sent to an inbox computed for an earlier deployment are lost), expect holdings to be gone and EVM nonces to restart at 0, and re-check the synchronizer ID in the docs.",
  };
}
