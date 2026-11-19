import { describe, expect, it } from "vitest";
import { deployContract, sendTransaction, WriteGuardError } from "../../src/core/write.js";
import { fakeContext } from "../fakes.js";

// A throwaway key that only exists in tests. It never touches a network.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const INBOX_CODE = "0x6080604052631be1956014610000630479e0aeb63479e0aeb";

function ctxWith(env: NodeJS.ProcessEnv, client: Record<string, unknown> = {}) {
  const ctx = fakeContext({ client: { getChainId: async () => 936485, ...client } });
  ctx.env = env;
  return ctx;
}

describe("write tool guards", () => {
  it("are disabled until the user configures a testnet key", async () => {
    await expect(
      sendTransaction(ctxWith({}), {
        to: "0x000000000000000000000000000000000000dEaD",
        valueZth: "0.1",
      }),
    ).rejects.toBeInstanceOf(WriteGuardError);
  });

  it("refuse to sign on any chain other than Zenith testnet", async () => {
    const ctx = ctxWith({ ZENITH_PRIVATE_KEY: TEST_KEY }, { getChainId: async () => 1 });
    await expect(deployContract(ctx, { bytecode: "0x6000" })).rejects.toThrow(/Refusing to sign/);
  });

  it("refuse a plain send to a Gateway inbox (the preflight cannot be skipped)", async () => {
    const ctx = ctxWith({ ZENITH_PRIVATE_KEY: TEST_KEY }, { getCode: async () => INBOX_CODE });
    const r = await sendTransaction(ctx, {
      to: "0x5e3E431C4F057F08A11B8c10f9840aE5de4e47ea",
      valueZth: "0.1",
    });
    expect(r.status).toBe("refused");
  });

  it("only simulate unless confirm is true", async () => {
    const ctx = ctxWith(
      { ZENITH_PRIVATE_KEY: TEST_KEY },
      {
        getCode: async () => "0x",
        estimateGas: async () => 21_000n,
        getGasPrice: async () => 1_000_000_000n,
        getBalance: async () => 10n ** 18n,
      },
    );
    const r = await sendTransaction(ctx, {
      to: "0x000000000000000000000000000000000000dEaD",
      valueZth: "0.1",
    });
    expect(r.status).toBe("simulated");
  });

  it("enforce the session spend cap", async () => {
    const ctx = ctxWith(
      { ZENITH_PRIVATE_KEY: TEST_KEY, ZENITH_SPEND_CAP_ZTH: "0.05" },
      {
        getCode: async () => "0x",
        estimateGas: async () => 21_000n,
        getGasPrice: async () => 1_000_000_000n,
        getBalance: async () => 10n ** 18n,
      },
    );
    await expect(
      sendTransaction(ctx, {
        to: "0x000000000000000000000000000000000000dEaD",
        valueZth: "0.1",
        confirm: true,
      }),
    ).rejects.toThrow(/spend cap/);
  });
});
