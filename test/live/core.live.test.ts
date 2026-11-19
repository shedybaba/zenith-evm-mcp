import { describe, expect, it } from "vitest";
import { createContext } from "../../src/core/context.js";
import { GATEWAY_ABI } from "../../src/core/abi.js";
import { loadGatewayTokens, matchGatewayToken } from "../../src/core/tokens.js";
import { checkReset } from "../../src/core/reset.js";

const live = process.env.ZENITH_LIVE === "1";

describe.skipIf(!live)("live testnet: core clients", () => {
  const ctx = createContext();

  it("talks to the right chain", async () => {
    expect(await ctx.client.getChainId()).toBe(936485);
    const chain = await ctx.gateway.chain();
    expect(chain.evmChainId).toBe(936485);
    expect(chain.gatewayAddress.toLowerCase()).toBe(ctx.network.gatewayAddress);
  });

  it("builds the Gateway token table from the registries", async () => {
    const tokens = await loadGatewayTokens(ctx);
    const keys = tokens.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["ZTH", "DevUSD", "DevCC"]));
    const usd = matchGatewayToken(tokens, "DevUSD")!;
    expect(usd.evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(usd.toCanton.recipientNeeds).toMatch(/standing acceptance/);
    const original = tokens.find((t) => t.kind === "erc20-original")!;
    expect(original.canton.symbol).toMatch(/e-8$/);
    expect(matchGatewayToken(tokens, original.evm.address!)?.key).toBe(original.key);
  });

  it("computes an inbox with the Gateway contract", async () => {
    const chain = await ctx.gateway.chain();
    const party = `alice::${chain.namespace}`;
    const inbox = await ctx.client.readContract({
      address: ctx.network.gatewayAddress,
      abi: GATEWAY_ABI,
      functionName: "inboxOf",
      args: [party],
    });
    expect(inbox).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("reports the reset status", async () => {
    const r = await checkReset(ctx);
    expect(["unchanged", "reset-since-release"]).toContain(r.status);
  });

  it("reads explorer health and faucet status", async () => {
    const [health, faucet] = await Promise.all([ctx.explorer.health(), ctx.explorer.faucet()]);
    expect(health.services.evm).toBeDefined();
    expect(typeof faucet.enabled).toBe("boolean");
  });
});
