import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createContext, type ZenithContext } from "./core/context.js";
import { SERVER_INSTRUCTIONS } from "./knowledge.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerChainTools } from "./tools/chain.js";
import { registerGatewayTools } from "./tools/gateway.js";
import { registerNetworkTools } from "./tools/network.js";
import { VERSION } from "./version.js";

export function createServer(ctx: ZenithContext = createContext()): McpServer {
  const server = new McpServer(
    { name: "zenith-evm-mcp", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerNetworkTools(server, ctx);
  registerChainTools(server, ctx);
  registerGatewayTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
