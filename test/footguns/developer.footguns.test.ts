/**
 * Zenith-specific behaviour that breaks ordinary Ethereum code, from "Differences from Ethereum Mainnet"
 * and the JSON-RPC limits in the Zenith docs, plus the Osaka/Prague mismatch confirmed on the network.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanBytecode, scanPath, scanScript, scanSolidity } from "../../src/core/compat.js";
import { compileSolidity } from "../../src/core/solidity.js";

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe("Differences from Ethereum: blocks are produced on demand", () => {
  it("flags block.number used as a clock", () => {
    expect(rules(scanSolidity("function f() { require(block.number > start + 100); }"))).toContain(
      "block-number-timing",
    );
  });

  it("flags waiting for several confirmations, which can hang on an idle chain", () => {
    expect(
      rules(scanScript("await client.waitForTransactionReceipt({ hash, confirmations: 3 })")),
    ).toContain("extra-confirmations");
    expect(rules(scanScript("await tx.wait(5)"))).toContain("extra-confirmations");
    expect(rules(scanScript("await tx.wait(1, 120_000)"))).not.toContain("extra-confirmations");
  });
});

describe("Differences from Ethereum: PREVRANDAO and blobs", () => {
  it("flags prevrandao used for randomness", () => {
    expect(
      rules(scanSolidity("uint r = uint(keccak256(abi.encode(block.prevrandao)));")),
    ).toContain("prevrandao-randomness");
  });

  it("flags blob opcodes (EIP-4844 is not supported)", () => {
    expect(rules(scanSolidity("bytes32 h = blobhash(0);"))).toContain("blob-opcodes");
  });
});

describe("Prague, not Osaka (verified on-chain: CLZ fails with NotActivated)", () => {
  it("flags CLZ in bytecode", () => {
    expect(rules(scanBytecode("0x60011e60005260206000f3"))).toContain("osaka-opcode");
  });

  it("does not mistake PUSH data for an opcode", () => {
    expect(rules(scanBytecode("0x601e600052"))).not.toContain("osaka-opcode");
  });

  it("flags an Osaka target in foundry.toml and a missing evm_version", () => {
    const dir = mkdtempSync(join(tmpdir(), "zenith-compat-"));
    writeFileSync(join(dir, "foundry.toml"), '[profile.default]\nevm_version = "osaka"\n');
    expect(rules(scanPath(dir).findings)).toContain("evm-version-osaka");
    writeFileSync(join(dir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");
    expect(rules(scanPath(dir).findings)).toContain("evm-version-unset");
  });

  it("compiles for Prague by default, even though solc's own default is Osaka", async () => {
    const r = await compileSolidity({
      source: "pragma solidity ^0.8.24; contract A { uint public x; }",
      fileName: "A.sol",
    });
    expect((r.standardJsonInput.settings as { evmVersion: string }).evmVersion).toBe("prague");
    expect(scanBytecode(r.deployedBytecode).filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("Contracts missing on Zenith testnet", () => {
  it.each([
    ["multicall3-address", "0xcA11bde05977b3631167028862bE2a173976CA11"],
    ["permit2-address", "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
    ["entrypoint-address", "0x0000000071727De22E5E9d8BAf0edAc6f37da032"],
    ["createx-address", "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed"],
  ])("flags %s", (rule, address) => {
    expect(rules(scanSolidity(`address constant X = ${address};`))).toContain(rule);
  });

  it("flags viem multicall batching", () => {
    expect(rules(scanScript("createPublicClient({ batch: { multicall: true } })"))).toContain(
      "multicall-batching",
    );
  });
});

describe("JSON-RPC: no WebSockets, filters or subscriptions; getLogs ≤ 1000 blocks", () => {
  it("flags WebSocket transports", () => {
    expect(rules(scanScript('const t = webSocket("wss://example")'))).toContain("websocket");
  });

  it("flags filters and subscriptions", () => {
    expect(rules(scanScript('await client.request({ method: "eth_newFilter" })'))).toContain(
      "filters-subscriptions",
    );
  });

  it("flags watchers that do not poll", () => {
    expect(rules(scanScript("client.watchContractEvent({ address, abi, onLogs })"))).toContain(
      "watchers-need-polling",
    );
  });

  it("flags getLogs from block 0", () => {
    expect(rules(scanScript("await client.getLogs({ address, fromBlock: 0n })"))).toContain(
      "unbounded-getlogs",
    );
  });

  it("ignores commented-out code", () => {
    expect(scanScript("// const t = webSocket('wss://x')\n/* eth_newFilter */")).toEqual([]);
  });
});
