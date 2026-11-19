import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { scanBytecode, scanPath, scanScript, scanSolidity, summarize } from "../core/compat.js";
import type { ZenithContext } from "../core/context.js";
import { projectConfig, type ToolName } from "../core/projectConfig.js";
import { verifyContract } from "../core/verify.js";
import { fail, guard, ok, READ_ONLY } from "./util.js";

const compilerOptions = {
  contractName: z.string().optional().describe("Contract to use when the file has several"),
  compilerVersion: z
    .string()
    .optional()
    .describe('solc version, e.g. "0.8.30" (default: bundled, if the pragma allows)'),
  optimize: z.boolean().default(true),
  runs: z.number().int().positive().default(200),
  evmVersion: z.string().default("prague").describe('EVM version; Zenith runs "prague"'),
};

export function registerDeveloperTools(server: McpServer, ctx: ZenithContext) {
  server.registerTool(
    "zenith_verify_contract",
    {
      title: "Verify a contract on the Zenith explorer",
      description:
        "Verifies a deployed contract through the explorer's Etherscan-compatible API. From a .sol file it compiles locally with the given settings, checks the bytecode matches the deployed code, then submits the exact standard-JSON input and waits for the result. Also accepts a standard-JSON input file (for example from forge verify-contract --show-standard-json-input).",
      inputSchema: {
        address: z.string(),
        sourcePath: z.string().optional().describe("Path to the .sol file"),
        standardJsonPath: z.string().optional(),
        qualifiedName: z.string().optional().describe('"File.sol:Contract", with standardJsonPath'),
        constructorArgs: z
          .string()
          .optional()
          .describe("ABI-encoded constructor arguments (hex), if any"),
        ...compilerOptions,
      },
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        if (!args.sourcePath && !args.standardJsonPath)
          return fail("Give sourcePath or standardJsonPath.");
        const r = await verifyContract(ctx, args);
        return ok(
          `${r.status.toUpperCase()}${"message" in r && r.message ? `: ${r.message}` : "reason" in r ? `: ${r.reason}` : ""}`,
          r,
        );
      }),
  );

  server.registerTool(
    "zenith_project_config",
    {
      title: "Tooling config for Zenith",
      description:
        "Ready-to-paste configuration for Foundry, Hardhat 3, Hardhat 2, viem, wagmi, MetaMask and .env, with the Zenith RPC, chain ID, explorer verification and the right EVM version (prague) already set, plus the notes that matter (no multicall, polling watchers, one-receipt finality).",
      inputSchema: {
        tools: z
          .array(z.enum(["foundry", "hardhat3", "hardhat2", "viem", "wagmi", "metamask", "env"]))
          .default([])
          .describe("Empty for all"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const cfg = projectConfig(ctx.network, args.tools as ToolName[]);
        const text = Object.entries(cfg)
          .map(
            ([tool, c]) =>
              `### ${tool} (${c.file})\n\`\`\`\n${c.content}\n\`\`\`\n${c.notes.map((n) => `- ${n}`).join("\n")}`,
          )
          .join("\n\n");
        return { content: [{ type: "text", text }], structuredContent: cfg };
      }),
  );

  server.registerTool(
    "zenith_check_compat",
    {
      title: "Check code for Zenith gotchas",
      description:
        "Scans Solidity, TypeScript/JavaScript or deployed bytecode for things that behave differently on Zenith: block.number used as a clock (blocks only come with transactions), prevrandao randomness, blob opcodes, Osaka-only opcodes and compiler targets (Zenith runs Prague), dependencies on Multicall3/Permit2/EntryPoint/CreateX (not deployed), WebSockets, filters and subscriptions (not available), waiting for many confirmations (can hang), and unbounded getLogs ranges.",
      inputSchema: {
        path: z.string().optional().describe("File or project folder to scan"),
        source: z.string().optional().describe("Source text to scan instead of a path"),
        language: z
          .enum(["solidity", "script"])
          .default("solidity")
          .describe("Language of `source`"),
        address: z.string().optional().describe("Deployed contract to scan by bytecode"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        let result: { scannedFiles?: number; findings: ReturnType<typeof scanSolidity> };
        if (args.path) result = scanPath(args.path);
        else if (args.source)
          result = {
            findings:
              args.language === "script" ? scanScript(args.source) : scanSolidity(args.source),
          };
        else if (args.address) {
          if (!isAddress(args.address, { strict: false }))
            return fail(`"${args.address}" is not an EVM address.`);
          const code = await ctx.client.getCode({ address: getAddress(args.address) });
          if (!code || code === "0x") return fail("No contract at that address.");
          result = { findings: scanBytecode(code) };
        } else return fail("Give a path, source or address.");
        const s = summarize(result.findings);
        return ok(`${s.errors} error(s), ${s.warnings} warning(s), ${s.info} note(s).`, {
          ...result,
          summary: s,
        });
      }),
  );
}
