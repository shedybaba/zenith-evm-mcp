import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, text } from "../helpers.js";

// Sends real testnet transactions. Needs ZENITH_KEY_FILE (or ZENITH_PRIVATE_KEY) with a little faucet ZTH.
const liveWrite = process.env.ZENITH_LIVE_WRITE === "1";

describe.skipIf(!liveWrite)("live testnet: deploy → verify → trace → call", () => {
  let s: Awaited<ReturnType<typeof connect>>;
  let counter: string;
  beforeAll(async () => {
    s = await connect({ ...process.env });
  });
  afterAll(() => s.close());

  it("simulates before deploying", async () => {
    const r = await s.call("zenith_deploy", { sourcePath: "examples/contracts/Counter.sol" });
    expect(r.structuredContent!.status, text(r)).toBe("simulated");
  });

  it("deploys, verifies and links the deployment to its Canton update", async () => {
    const r = await s.call("zenith_deploy", {
      sourcePath: "examples/contracts/Counter.sol",
      confirm: true,
    });
    const out = r.structuredContent as {
      status: string;
      contractAddress: string;
      verification: { status: string };
      trace: { canton: { updateId?: string } };
    };
    expect(out.status, text(r)).toBe("deployed");
    counter = out.contractAddress;
    expect(counter).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(out.verification.status).toBe("verified");
    expect(out.trace.canton.updateId).toMatch(/^1220/);
  });

  it("calls increment() and reads the new value", async () => {
    const sent = await s.call("zenith_send", {
      to: counter,
      function: "increment()",
      confirm: true,
    });
    expect(sent.structuredContent!.receiptStatus, text(sent)).toBe("success");
    const read = await s.call("zenith_read_contract", { address: counter, function: "number" });
    expect(String(read.structuredContent!.result)).toBe("1");
  });

  it("shows the contract as verified", async () => {
    const r = await s.call("zenith_get_account", {
      address: counter,
      includeTokenHoldings: false,
      recentTransactions: 0,
    });
    expect((r.structuredContent!.contract as { verified: boolean }).verified).toBe(true);
  });
});
