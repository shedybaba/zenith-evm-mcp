#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./core/context.js";
import { runDoctor } from "./doctor.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `zenith-evm-mcp ${VERSION}
MCP server for Zenith EVM (Canton Network).

Usage:
  zenith-evm-mcp            Start the MCP server on stdio (what MCP apps run)
  zenith-evm-mcp --doctor   Check connectivity and configuration, then exit
  zenith-evm-mcp --version  Print the version
  zenith-evm-mcp --help     Show this help

Environment:
  ZENITH_RPC_URL, ZENITH_EXPLORER_URL, ZENITH_GATEWAY_API_URL   Override endpoints
  ZENITH_PRIVATE_KEY or ZENITH_KEY_FILE                         Enable testnet write tools
  ZENITH_SPEND_CAP_ZTH                                          Max ZTH write tools may send per session (default 1)
`;

async function main() {
  const arg = process.argv[2];
  if (arg === "--version" || arg === "-v") {
    console.log(VERSION);
    return;
  }
  if (arg === "--help" || arg === "-h") {
    console.log(HELP);
    return;
  }
  if (arg === "--doctor") {
    process.exitCode = (await runDoctor(createContext())) ? 0 : 1;
    return;
  }
  if (arg) {
    console.error(`Unknown option ${arg}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
