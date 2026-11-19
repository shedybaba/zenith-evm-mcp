import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAddress, toFunctionSignature, type Abi, type AbiFunction, type Hex } from "viem";
import { z } from "zod";
import { ERC20_ABI } from "../core/abi.js";
import { accountInfo } from "../core/account.js";
import { coerceArgs } from "../core/args.js";
import type { ZenithContext } from "../core/context.js";
import { abiFromSignature, decodeCalldata, decodeEvent, decodeRevert } from "../core/decode.js";
import { getLogs } from "../core/logs.js";
import { traceTransaction } from "../core/transaction.js";
import { fail, guard, ok, READ_ONLY } from "./util.js";

const address = z.string().describe("EVM address (0x…)");
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "must be 0x-prefixed hex");

export function registerChainTools(server: McpServer, ctx: ZenithContext) {
  server.registerTool(
    "zenith_get_account",
    {
      title: "Account or contract details",
      description:
        "Balance, nonce, wallet vs contract, and for contracts: verified source, proxy implementation, ERC-20 metadata, and whether the address is a Gateway inbox. Also lists token holdings and recent transactions from the explorer.",
      inputSchema: {
        address,
        includeTokenHoldings: z
          .boolean()
          .default(true)
          .describe("Look up ERC-20 balances from the explorer's transfer index"),
        recentTransactions: z.number().int().min(0).max(25).default(5),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const info = await accountInfo(ctx, args.address, {
          holdings: args.includeTokenHoldings,
          recent: args.recentTransactions,
        });
        const kind = (info.contract?.kind as string | undefined) ?? info.type;
        return ok(
          `${info.address} is a ${kind} holding ${info.balance.zth} ZTH (nonce ${info.nonce}).`,
          info,
        );
      }),
  );

  server.registerTool(
    "zenith_get_transaction",
    {
      title: "Trace a transaction (EVM and Canton)",
      description:
        "Status, fee, decoded call and events (verified ABIs, ERC-20 and the Gateway's own events), whether it was a Gateway deposit, and the Canton update that settled it: update ID, command ID, settlement time. If it was never mined, explains why using Gateway's pending-transaction index.",
      inputSchema: {
        hash: z.string().describe("Transaction hash (0x + 64 hex)"),
        includeCantonLink: z
          .boolean()
          .default(true)
          .describe("Look up the Canton update in the explorer index (a few extra requests)"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const t = await traceTransaction(ctx, args.hash, { canton: args.includeCantonLink });
        if (!t.mined) return ok(`Not mined. ${t.explanation}`, t);
        const canton =
          t.canton && "updateId" in t.canton
            ? ` Settled on Canton in update ${String(t.canton.updateId).slice(0, 16)}…`
            : "";
        const action = t.call
          ? `${t.call.functionName}()`
          : t.contractCreated
            ? `contract creation (${t.contractCreated})`
            : "value transfer";
        return ok(
          `${t.status === "success" ? "Succeeded" : "Reverted"}: ${action} in block ${t.block.number}.${canton}`,
          t,
        );
      }),
  );

  server.registerTool(
    "zenith_read_contract",
    {
      title: "Call a view function",
      description:
        'Calls a contract function without sending a transaction. Give either a full signature (e.g. "balanceOf(address) view returns (uint256)") or just the function name if the contract is verified on the explorer (ERC-20 names work for any token). Arguments are converted to the right types.',
      inputSchema: {
        address,
        function: z.string().describe("Function name, or a signature with return types"),
        args: z.array(z.any()).default([]).describe("Arguments in order; integers may be strings"),
        abi: z.string().optional().describe("Optional JSON ABI to use instead of the verified one"),
        blockNumber: z.number().int().nonnegative().optional(),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const target = getAddress(args.address);
        let abi: Abi;
        let name = args.function.trim();
        if (name.includes("(")) {
          abi = abiFromSignature(name, "function");
          name = (abi[0] as AbiFunction).name;
        } else {
          abi = args.abi
            ? (JSON.parse(args.abi) as Abi)
            : ((await ctx.explorer.getAbi(target)) ?? ERC20_ABI);
        }
        const candidates = abi.filter(
          (i): i is AbiFunction => i.type === "function" && i.name === name,
        );
        const fn = candidates.find((c) => c.inputs.length === args.args.length) ?? candidates[0];
        if (!fn) {
          return fail(
            `No function "${name}" in the ABI. The contract may be unverified: pass a full signature such as "${name}(address) view returns (uint256)".`,
          );
        }
        const values = coerceArgs(fn.inputs, args.args);
        const result: unknown = await ctx.client.readContract({
          address: target,
          abi: [fn],
          functionName: fn.name,
          args: values,
          blockNumber: args.blockNumber !== undefined ? BigInt(args.blockNumber) : undefined,
        });
        const note =
          fn.stateMutability === "view" || fn.stateMutability === "pure"
            ? undefined
            : "Simulated with eth_call; nothing was sent.";
        return ok(
          `${fn.name} → ${typeof result === "bigint" ? result.toString() : JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
          {
            address: target,
            function: toFunctionSignature(fn),
            result,
            note,
          },
        );
      }),
  );

  server.registerTool(
    "zenith_get_logs",
    {
      title: "Get decoded event logs",
      description:
        "Event logs for a contract and/or event over any block range, decoded. The public RPC only serves 1,000 blocks per call and has no filters or WebSockets, so the range is walked in chunks from newest to oldest; use nextToBlock to continue. Defaults to the last 1,000 blocks.",
      inputSchema: {
        address: address.optional(),
        event: z
          .string()
          .optional()
          .describe(
            'Event signature, e.g. "Transfer(address indexed from, address indexed to, uint256 value)"',
          ),
        fromBlock: z.number().int().nonnegative().optional(),
        toBlock: z.number().int().nonnegative().optional(),
        maxLogs: z.number().int().min(1).max(1000).default(100),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        if (!args.address && !args.event)
          return fail("Give an address, an event signature, or both.");
        const r = await getLogs(ctx, args);
        return ok(
          `${r.count} log(s) between blocks ${r.scanned.fromBlock} and ${r.scanned.toBlock}${r.truncated ? `; more may exist, continue with toBlock=${r.nextToBlock}` : ""}.`,
          r,
        );
      }),
  );

  server.registerTool(
    "zenith_decode",
    {
      title: "Decode calldata, an event or a revert",
      description:
        "Decodes raw hex using the contract's verified ABI, a signature you give, ERC-20, or the Gateway's events and errors (including the inbox's NotWholeQuanta error).",
      inputSchema: {
        kind: z.enum(["calldata", "event", "revert"]),
        data: hex.describe("Calldata, event data or revert data"),
        topics: z.array(hex).optional().describe("Event topics (for kind=event)"),
        address: address.optional().describe("Contract address, to use its verified ABI"),
        signature: z.string().optional().describe("Function or event signature to decode with"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const addr = args.address ? getAddress(args.address) : undefined;
        if (args.kind === "calldata") {
          const r = await decodeCalldata(ctx, args.data as Hex, {
            address: addr,
            signature: args.signature,
          });
          return ok(
            r.functionName ? `Call to ${r.functionName}` : "Could not decode the calldata.",
            r,
          );
        }
        if (args.kind === "event") {
          if (!args.topics?.length) return fail("Events need their topics.");
          const r = await decodeEvent(
            ctx,
            { address: addr, topics: args.topics as Hex[], data: args.data as Hex },
            { signature: args.signature },
          );
          return ok(
            r.event
              ? `${r.event} event${r.meaning ? `: ${r.meaning}` : ""}`
              : "Could not decode the event.",
            r,
          );
        }
        const r = await decodeRevert(ctx, args.data as Hex, { address: addr });
        return ok(r.errorName ? `Reverted with ${r.errorName}` : "Unknown revert reason.", r);
      }),
  );
}
