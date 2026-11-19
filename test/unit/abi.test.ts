import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Hex } from "viem";
import {
  decodeCall,
  decodeLog,
  ERC20_ABI,
  GATEWAY_ABI,
  looksLikeGatewayInbox,
} from "../../src/core/abi.js";
import logs from "../fixtures/gateway-logs.json" with { type: "json" };

describe("Gateway event decoding (recorded testnet logs)", () => {
  const decoded = logs.map((l) =>
    decodeLog({ address: l.address as Hex, topics: l.topics as Hex[], data: l.data as Hex }, [
      { abi: GATEWAY_ABI, source: "gateway" },
    ]),
  );

  it("decodes every event the Gateway contract has emitted", () => {
    expect(decoded.every((d) => d.event !== null)).toBe(true);
    expect(new Set(decoded.map((d) => d.event))).toEqual(
      new Set([
        "Released",
        "Collected",
        "NativeCollected",
        "MetadataSet",
        "WrapperRegistered",
        "Minted",
        "OriginalRegistered",
      ]),
    );
  });

  it("explains what each crossing event means", () => {
    const released = decoded.find((d) => d.event === "Released")!;
    expect(released.meaning).toMatch(/Canton → Zenith EVM/);
    expect(released.args).toHaveProperty("amount");
  });
});

describe("call decoding", () => {
  it("decodes an ERC-20 transfer", () => {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: ["0x000000000000000000000000000000000000dEaD", 5n],
    });
    const d = decodeCall(data, [{ abi: ERC20_ABI, source: "erc20" }]);
    expect(d?.functionName).toBe("transfer");
    expect(d?.args[1]).toBe(5n);
  });

  it("returns null for empty calldata", () => {
    expect(decodeCall("0x", [{ abi: ERC20_ABI, source: "erc20" }])).toBeNull();
  });
});

describe("inbox recognition", () => {
  it("recognises inbox bytecode by its selectors", () => {
    expect(
      looksLikeGatewayInbox("0x6080604052631be1956014610000630479e0aeb63479e0aeb" as Hex),
    ).toBe(true);
    expect(looksLikeGatewayInbox("0x6080604052" as Hex)).toBe(false);
    expect(looksLikeGatewayInbox("0x")).toBe(false);
  });
});
