import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, text } from "../helpers.js";

const live = process.env.ZENITH_LIVE === "1";
// A testnet address that holds ZTH and DevUSD wrapper tokens (it received Gateway mints).
const SENDER = "0x5a2d8970f687f1bcfeb522922c6e7fa4a683958c";

describe.skipIf(!live)("live testnet: Gateway tools", () => {
  let s: Awaited<ReturnType<typeof connect>>;
  let devAdmin: string;
  let namespace: string;
  beforeAll(async () => {
    s = await connect();
    const regs = await s.ctx.gateway.registries();
    devAdmin = regs.registries.find((r) => r.kind === "dev")!.admin;
    namespace = (await s.ctx.gateway.chain()).namespace;
  });
  afterAll(() => s.close());

  const verdict = (r: Awaited<ReturnType<typeof s.call>>) => r.structuredContent!.verdict;
  const checkStatus = (r: Awaited<ReturnType<typeof s.call>>, id: string) =>
    (r.structuredContent!.checks as { id: string; status: string }[]).find((c) => c.id === id)
      ?.status;

  it("READY for a known party, with a passing dry run", async () => {
    const r = await s.call("gateway_preflight", {
      partyId: devAdmin,
      token: "ZTH",
      amount: "0.5",
      from: SENDER,
    });
    expect(verdict(r), text(r)).toBe("ready");
    expect(checkStatus(r, "recipient_known")).toBe("pass");
    expect(checkStatus(r, "network_dry_run")).toBe("pass");
  });

  it("BLOCKED for a well-formed but unknown party that the network itself would accept", async () => {
    const r = await s.call("gateway_preflight", {
      partyId: `alice::1220${"ab".repeat(32)}`,
      token: "ZTH",
      amount: "0.5",
      from: SENDER,
    });
    expect(verdict(r)).toBe("blocked");
    expect(checkStatus(r, "recipient_known")).toBe("fail");
    expect(checkStatus(r, "network_dry_run")).toBe("pass");
  });

  it("surfaces the network's own refusal for a recipient without a standing acceptance", async () => {
    const r = await s.call("gateway_preflight", {
      partyId: devAdmin,
      token: "DevUSD",
      amount: "0.01",
      from: SENDER,
    });
    expect(verdict(r)).toBe("blocked");
    expect(checkStatus(r, "network_dry_run")).toBe("fail");
    expect(text(r)).toMatch(/standing acceptance/);
  });

  it("the network agrees that unaligned ZTH is refused", async () => {
    const r = await s.call("gateway_preflight", {
      partyId: devAdmin,
      token: "ZTH",
      amount: "0.123456789123",
      from: SENDER,
    });
    expect(checkStatus(r, "zth_quantum")).toBe("fail");
    expect(checkStatus(r, "network_dry_run")).toBe("fail");
  });

  it("refuses protocol parties before computing anything", async () => {
    const r = await s.call("gateway_inbox", { partyId: `m-abc::${namespace}` });
    expect(r.isError).toBe(true);
  });

  it("tracks a real past deposit to CREDITED", async () => {
    const r = await s.call("gateway_deposit_status", {
      hash: "0xd67e566003194bb8d0521d9b4a752973014f2253aa38d6b62af679c5954013a8",
    });
    expect(r.structuredContent!.stage).toBe("credited");
  });

  it("lists Gateway crossings with per-token counts", async () => {
    const r = await s.call("gateway_activity", { limit: 5 });
    expect(r.structuredContent!.totalCrossings as number).toBeGreaterThan(0);
  });

  it("derives a mailbox and its state", async () => {
    const r = await s.call("gateway_mailbox", {
      evmAddress: "0x000000000000000000000000000000000000dEaD",
      token: "DevUSD",
    });
    expect(String(r.structuredContent!.mailboxParty)).toMatch(/^m-/);
  });

  it("pre-screens a token with a simulated transfer from a real holder", async () => {
    const r = await s.call("gateway_token_eligibility", {
      address: "0x41f21e381a70e404854d1f95788208bbc6a8cd72",
    });
    expect(checkStatus(r, "exact_transfer")).toBe("pass");
    expect(checkStatus(r, "functions_pause")).toBe("warn");
  });
});
