import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIMITS } from "./core/config.js";
import type { ZenithContext } from "./core/context.js";
import { networkInfo } from "./core/health.js";
import { stringify } from "./core/json.js";
import { loadGatewayTokens } from "./core/tokens.js";
import { DIFFERENCES, GATEWAY_CHECKLIST } from "./knowledge.js";

export function registerResources(server: McpServer, ctx: ZenithContext) {
  server.registerResource(
    "network",
    "zenith://network",
    {
      title: "Zenith network",
      description: "Live network info: endpoints, latest block, Gateway deployment.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: stringify(await networkInfo(ctx)) },
      ],
    }),
  );

  server.registerResource(
    "limits",
    "zenith://limits",
    { title: "Public RPC and explorer limits", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: stringify(LIMITS) }],
    }),
  );

  server.registerResource(
    "gateway-tokens",
    "zenith://gateway/tokens",
    {
      title: "Gateway tokens",
      description: "Every token Gateway can move, with both sides described.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: stringify(await loadGatewayTokens(ctx)),
        },
      ],
    }),
  );

  server.registerResource(
    "gateway-checklist",
    "zenith://gateway/checklist",
    { title: "Gateway: before you send", mimeType: "text/markdown" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: GATEWAY_CHECKLIST }],
    }),
  );

  server.registerResource(
    "differences",
    "zenith://differences",
    { title: "Zenith EVM vs Ethereum", mimeType: "text/markdown" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: DIFFERENCES }],
    }),
  );
}
