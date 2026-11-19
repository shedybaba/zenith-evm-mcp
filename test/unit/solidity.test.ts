import { describe, expect, it } from "vitest";
import { compileSolidity, satisfiesPragma, stripMetadata } from "../../src/core/solidity.js";
import { projectConfig } from "../../src/core/projectConfig.js";
import { TESTNET } from "../../src/core/config.js";

describe("satisfiesPragma", () => {
  it.each([
    ["^0.8.24", "0.8.39", true],
    ["^0.8.24", "0.9.0", false],
    ["0.8.20", "0.8.20", true],
    ["0.8.20", "0.8.21", false],
    [">=0.8.0 <0.9.0", "0.8.30", true],
    [">=0.8.0 <0.8.10", "0.8.30", false],
    ["~0.8.4", "0.8.9", true],
    ["^0.7.0 || ^0.8.0", "0.8.30", true],
  ])("%s with %s → %s", (pragma, version, expected) => {
    expect(satisfiesPragma(pragma, version)).toBe(expected);
  });
});

describe("compileSolidity", () => {
  it("compiles the quickstart Counter and returns a verifiable standard-JSON input", async () => {
    const r = await compileSolidity({ sourcePath: "examples/contracts/Counter.sol" });
    expect(r.qualifiedName).toBe("Counter.sol:Counter");
    expect(r.compilerVersion).toMatch(/^v0\.8\.\d+\+commit\.[0-9a-f]{8}$/);
    expect(r.abi.some((i) => i.type === "function" && i.name === "increment")).toBe(true);
    expect(Object.keys((r.standardJsonInput as { sources: object }).sources)).toEqual([
      "Counter.sol",
    ]);
  });

  it("reports compilation errors clearly", async () => {
    await expect(
      compileSolidity({
        source: "pragma solidity ^0.8.24; contract X { function }",
        fileName: "X.sol",
      }),
    ).rejects.toThrow(/Compilation failed/);
  });
});

describe("stripMetadata", () => {
  it("removes the trailing CBOR metadata", () => {
    expect(stripMetadata("0x6000a16500112233440007")).toBe("6000");
  });
});

describe("projectConfig", () => {
  it("pins Prague and points verification at the Zenith explorer", () => {
    const cfg = projectConfig(TESTNET, ["foundry", "viem"]);
    expect(cfg.foundry!.content).toContain('evm_version = "prague"');
    expect(cfg.foundry!.content).toContain(TESTNET.explorerApiUrl);
    expect(cfg.viem!.content).toContain("936485");
  });
});
