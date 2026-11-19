import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, text } from "../helpers.js";

const live = process.env.ZENITH_LIVE === "1";

describe.skipIf(!live)("live testnet: read tools", () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(() => s.close());

  it("zenith_network_info", async () => {
    const r = await s.call("zenith_network_info");
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent!.network as { chainId: number }).chainId).toBe(936485);
  });

  it("zenith_health gives a verdict", async () => {
    const r = await s.call("zenith_health");
    expect(["healthy", "idle", "degraded", "possible-reset"]).toContain(
      r.structuredContent!.verdict,
    );
  });

  it("zenith_get_account recognises the Gateway contract", async () => {
    const r = await s.call("zenith_get_account", {
      address: "0x00000000000000000000000000000000000a7e00",
      includeTokenHoldings: false,
      recentTransactions: 0,
    });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent!.contract as { kind: string }).kind).toBe("zenith-gateway");
  });

  it("zenith_get_transaction links a recent transaction to its Canton update", async () => {
    const recent = await s.ctx.explorer.externalCalls(1, 5);
    const hash = recent.data.find((c) => c.evmTxHash)!.evmTxHash!;
    const r = await s.call("zenith_get_transaction", { hash });
    expect(r.isError, text(r)).toBeFalsy();
    const canton = r.structuredContent!.canton as { updateId?: string };
    expect(canton.updateId).toMatch(/^1220/);
  });

  it("zenith_read_contract reads an ERC-20 by name", async () => {
    const tokens = await s.ctx.gateway.registries();
    const token = tokens.registries.find((r) => r.kind === "wrapped-erc20")!.token!;
    const r = await s.call("zenith_read_contract", { address: token, function: "decimals" });
    expect(r.isError, text(r)).toBeFalsy();
    expect(String(r.structuredContent!.result)).toBe("18");
  });

  it("zenith_get_logs decodes the Gateway's events over the full history", async () => {
    const r = await s.call("zenith_get_logs", {
      address: "0x00000000000000000000000000000000000a7e00",
      fromBlock: 0,
      maxLogs: 50,
    });
    expect(r.isError, text(r)).toBeFalsy();
    const logs = r.structuredContent!.logs as { event: string | null; source: string }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.event && l.source === "gateway")).toBe(true);
  });

  it("zenith_decode explains the inbox quantum error", async () => {
    const r = await s.call("zenith_decode", {
      kind: "revert",
      data: "0x479e0aeb0000000000000000000000000000000000000000000000000000000000000001",
    });
    expect(r.structuredContent!.errorName).toBe("NotWholeQuanta");
  });
});
