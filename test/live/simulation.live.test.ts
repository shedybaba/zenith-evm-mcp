import { readFileSync } from "node:fs";
import solc from "solc";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, numberToHex, type Address, type Hex } from "viem";
import { createContext } from "../../src/core/context.js";
import { simulateTransfer } from "../../src/core/eligibility.js";

const live = process.env.ZENITH_LIVE === "1";

function compileTestTokens(): Record<string, Hex> {
  const input = {
    language: "Solidity",
    sources: {
      "TestTokens.sol": { content: readFileSync("test/fixtures/TestTokens.sol", "utf8") },
    },
    settings: {
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const c = out.contracts["TestTokens.sol"];
  return {
    plain: `0x${c.PlainToken.evm.deployedBytecode.object}`,
    fee: `0x${c.FeeOnTransferToken.evm.deployedBytecode.object}`,
  };
}

describe.skipIf(!live)("live testnet: transfer simulation catches fee-on-transfer tokens", () => {
  const ctx = createContext();
  const code: Record<string, Hex> = live ? compileTestTokens() : { plain: "0x", fee: "0x" };
  const holder = "0x00000000000000000000000000000000000c0ffe" as Address;
  const token = "0x0000000000000000000000000000000000fee000" as Address;
  const balanceSlot = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n]),
  );
  const balance = 1_000n * 10n ** 18n;
  const override = (runtime: Hex) => [
    {
      address: token,
      code: runtime,
      stateDiff: [{ slot: balanceSlot, value: numberToHex(balance, { size: 32 }) }],
    },
  ];

  it("a plain token moves exactly the amount", async () => {
    const r = await simulateTransfer(ctx, token, holder, 100n * 10n ** 18n, override(code.plain!));
    expect(r.callSucceeded).toBe(true);
    expect(r.senderDelta).toBe(100n * 10n ** 18n);
    expect(r.recipientDelta).toBe(100n * 10n ** 18n);
  });

  it("a 5% fee-on-transfer token is caught: the recipient gets 95", async () => {
    const r = await simulateTransfer(ctx, token, holder, 100n * 10n ** 18n, override(code.fee!));
    expect(r.callSucceeded).toBe(true);
    expect(r.senderDelta).toBe(100n * 10n ** 18n);
    expect(r.recipientDelta).toBe(95n * 10n ** 18n);
  });
});
