import { readFileSync } from "node:fs";
import { getAddress, isAddress } from "viem";
import type { ZenithContext } from "./context.js";
import { compileSolidity, stripMetadata, type CompileOptions } from "./solidity.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface VerifyInput extends CompileOptions {
  address: string;
  /** Path to a standard-JSON input file (for example from `forge verify-contract --show-standard-json-input`). */
  standardJsonPath?: string;
  /** "path/File.sol:Contract", required with standardJsonPath. */
  qualifiedName?: string;
  constructorArgs?: string;
}

/**
 * Verifies a contract on the Zenith explorer through its Etherscan-compatible API. With a source file it
 * compiles locally first and checks the bytecode matches, so a failed attempt does not spend one of the
 * 30 verifications per hour.
 */
export async function verifyContract(ctx: ZenithContext, input: VerifyInput) {
  if (!isAddress(input.address, { strict: false }))
    throw new Error(`"${input.address}" is not an EVM address`);
  const address = getAddress(input.address);
  const onchain = await ctx.client.getCode({ address });
  if (!onchain || onchain === "0x") throw new Error(`No contract deployed at ${address}`);

  const existing = await ctx.explorer.getSourceInfo(address).catch(() => null);
  if (existing?.verified) {
    return {
      address,
      status: "already-verified",
      contractName: existing.contractName,
      compilerVersion: existing.compilerVersion,
      explorer: ctx.explorer.addressUrl(address),
    };
  }

  let standardJson: string;
  let qualifiedName: string;
  let compilerVersion: string;
  let localMatch: boolean | null = null;
  if (input.standardJsonPath) {
    if (!input.qualifiedName || !input.compilerVersion)
      throw new Error(
        "With standardJsonPath, also give qualifiedName (File.sol:Contract) and compilerVersion.",
      );
    standardJson = readFileSync(input.standardJsonPath, "utf8");
    qualifiedName = input.qualifiedName;
    compilerVersion = input.compilerVersion.startsWith("v")
      ? input.compilerVersion
      : `v${input.compilerVersion}`;
  } else {
    const compiled = await compileSolidity(input);
    standardJson = JSON.stringify(compiled.standardJsonInput);
    qualifiedName = compiled.qualifiedName;
    compilerVersion = compiled.compilerVersion;
    localMatch = stripMetadata(compiled.deployedBytecode) === stripMetadata(onchain);
    if (
      !localMatch &&
      stripMetadata(compiled.deployedBytecode).length !== stripMetadata(onchain).length
    ) {
      return {
        address,
        status: "not-submitted",
        reason:
          "The locally compiled runtime bytecode does not match the deployed code (different length). Check the compiler version, optimizer settings, evmVersion and contract name used at deployment.",
        tried: {
          qualifiedName,
          compilerVersion,
          optimize: input.optimize ?? true,
          runs: input.runs ?? 200,
          evmVersion: input.evmVersion ?? "prague",
        },
      };
    }
  }

  const args = (input.constructorArgs ?? "").replace(/^0x/, "");
  const guid = await ctx.explorer.verifySource({
    codeformat: "solidity-standard-json-input",
    sourceCode: standardJson,
    contractaddress: address,
    contractname: qualifiedName,
    compilerversion: compilerVersion,
    constructorArguements: args,
    constructorArguments: args,
  });

  let last = { done: false, ok: false, message: "pending" };
  for (let i = 0; i < 30 && !last.done; i++) {
    await sleep(3000);
    last = await ctx.explorer.checkVerifyStatus(guid);
  }
  return {
    address,
    status: last.ok ? "verified" : last.done ? "failed" : "pending",
    message: last.message,
    guid,
    qualifiedName,
    compilerVersion,
    localBytecodeMatch: localMatch,
    explorer: ctx.explorer.addressUrl(address),
  };
}
