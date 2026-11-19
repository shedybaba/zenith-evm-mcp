import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createContext } from "../src/core/context.js";
import { createServer } from "../src/server.js";

/** Starts the server in memory and returns a connected MCP client. */
export async function connect(
  env: NodeJS.ProcessEnv = { ...process.env, ZENITH_PRIVATE_KEY: "", ZENITH_KEY_FILE: "" },
) {
  const ctx = createContext(env);
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult & {
      structuredContent?: Record<string, unknown>;
    };
  return { client, ctx, call, close: () => client.close() };
}

export const text = (r: CallToolResult) =>
  r.content.map((c) => ("text" in c ? c.text : "")).join("\n");
