import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ZenithContext } from "../core/context.js";
import { deployContract, sendTransaction, WriteGuardError } from "../core/write.js";
import { fail, guard, ok } from "./util.js";

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export function registerWriteTools(server: McpServer, ctx: ZenithContext) {
  server.registerTool(
    "zenith_deploy",
    {
      title: "Deploy a contract (testnet, opt-in)",
      description:
        "Deploys a contract to Zenith testnet from a .sol file (compiled for Prague and verified automatically), a Foundry/Hardhat artifact or bytecode. Without confirm it only simulates and shows the cost. Requires a testnet key configured by the user; refuses any other chain and respects the session spend cap.",
      inputSchema: {
        sourcePath: z.string().optional().describe("Path to a .sol file"),
        contractName: z.string().optional(),
        artifactPath: z
          .string()
          .optional()
          .describe("Foundry out/X.sol/X.json or Hardhat artifact"),
        bytecode: z.string().optional(),
        abi: z.string().optional().describe("JSON ABI, with bytecode"),
        constructorArgs: z.array(z.any()).default([]),
        compilerVersion: z.string().optional(),
        optimize: z.boolean().default(true),
        runs: z.number().int().positive().default(200),
        evmVersion: z.string().default("prague"),
        verify: z.boolean().default(true),
        confirm: z
          .boolean()
          .default(false)
          .describe("Set true only after the user approved the simulated plan"),
      },
      annotations: WRITE,
    },
    (args) =>
      guard(async () => {
        try {
          const r = await deployContract(ctx, args);
          const summary =
            r.status === "deployed"
              ? `Deployed ${"contractAddress" in r ? r.contractAddress : ""} in ${"hash" in r ? r.hash : ""}.`
              : r.status === "simulated"
                ? `Simulated: ~${r.plan.maxFeeZth} ZTH max fee from ${r.plan.from}. Call again with confirm=true to deploy.`
                : `Refused: ${"reason" in r ? r.reason : ""}`;
          return ok(summary, r);
        } catch (err) {
          if (err instanceof WriteGuardError) return fail(err.message);
          throw err;
        }
      }),
  );

  server.registerTool(
    "zenith_send",
    {
      title: "Send a transaction (testnet, opt-in)",
      description:
        "Sends ZTH, an ERC-20 transfer or a contract call on Zenith testnet. For a transfer to a Canton party, set gatewayPartyId (with token and amount): the full Gateway preflight runs first and blocked sends are refused. Plain sends to a Gateway inbox are refused so the checks cannot be skipped. Without confirm it only simulates.",
      inputSchema: {
        to: z.string().optional().describe("Recipient or contract address"),
        valueZth: z.string().optional().describe('Native ZTH to send, e.g. "0.1"'),
        token: z.string().optional().describe("ERC-20 to transfer (symbol or address)"),
        amount: z.string().optional().describe("Token amount (whole tokens)"),
        function: z
          .string()
          .optional()
          .describe('Function signature for a contract call, e.g. "increment()"'),
        args: z.array(z.any()).default([]),
        gatewayPartyId: z.string().optional().describe("Send to this Canton party through Gateway"),
        confirm: z
          .boolean()
          .default(false)
          .describe("Set true only after the user approved the simulated plan"),
      },
      annotations: WRITE,
    },
    (args) =>
      guard(async () => {
        try {
          const r = await sendTransaction(ctx, args);
          const summary =
            r.status === "sent"
              ? `Sent ${"hash" in r ? r.hash : ""} (${"receiptStatus" in r ? r.receiptStatus : ""}).`
              : r.status === "simulated"
                ? `Simulated: ${r.plan?.description}; max fee ~${r.plan?.maxFeeZth} ZTH. Call again with confirm=true to send.`
                : `Refused: ${r.reason}`;
          return ok(summary, r);
        } catch (err) {
          if (err instanceof WriteGuardError) return fail(err.message);
          throw err;
        }
      }),
  );
}
