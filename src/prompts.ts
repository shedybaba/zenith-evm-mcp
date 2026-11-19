import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const user = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "deploy_and_verify",
    {
      title: "Deploy and verify a contract",
      description:
        "Check a Solidity contract for Zenith gotchas, deploy it to testnet, verify it and trace the deployment to Canton.",
      argsSchema: {
        sourcePath: z.string().describe("Path to the .sol file"),
        contractName: z.string().optional(),
      },
    },
    ({ sourcePath, contractName }) =>
      user(`Deploy ${sourcePath}${contractName ? ` (contract ${contractName})` : ""} to Zenith EVM testnet.
1. Run zenith_check_compat on the file and stop if it reports errors; explain any warnings.
2. Run zenith_health; if the verdict is degraded, stop and report.
3. Call zenith_deploy without confirm to see the simulation and cost, show it to me, and wait for my go-ahead.
4. After I confirm, deploy with confirm=true (it verifies the source automatically).
5. Call zenith_get_transaction on the deployment hash and show the Canton update that settled it.`),
  );

  server.registerPrompt(
    "send_to_canton_safely",
    {
      title: "Send tokens to a Canton party safely",
      description:
        "Run every Gateway check before sending tokens from Zenith EVM to a Canton party.",
      argsSchema: {
        partyId: z.string(),
        token: z.string().describe("ZTH, a symbol or an ERC-20 address"),
        amount: z.string(),
      },
    },
    ({ partyId, token, amount }) =>
      user(`I want to send ${amount} ${token} from Zenith EVM to the Canton party ${partyId}.
1. Call gateway_preflight with these values and my wallet address as sender.
2. Show me every check. If any check fails, explain the fix and stop.
3. If all checks pass, show the exact transaction (to, value, data) and the amount that will arrive on Canton.
4. Only send if I confirm, using zenith_send with gatewayPartyId set, and then track it with gateway_deposit_status.`),
  );

  server.registerPrompt(
    "investigate_missing_deposit",
    {
      title: "Find a missing Gateway deposit",
      description: "Work out what happened to a transfer between Zenith EVM and Canton.",
      argsSchema: { txHash: z.string() },
    },
    ({ txHash }) =>
      user(`My Gateway transfer ${txHash} has not arrived.
1. Call gateway_deposit_status with the hash.
2. If it was mined, call zenith_get_transaction and check the recipient inbox, the token and the Gateway events.
3. Explain in plain words what happened, using the Zenith docs' Common problems table, and give me the exact next step (wait, resend at a given nonce, fix the recipient, or contact Zenith with the hash, update ID and UTC time).`),
  );

  server.registerPrompt(
    "audit_token_for_gateway",
    {
      title: "Check a token for Gateway registration",
      description: "Pre-screen an ERC-20 against Zenith's registration criteria.",
      argsSchema: { tokenAddress: z.string() },
    },
    ({ tokenAddress }) =>
      user(`Check whether the ERC-20 at ${tokenAddress} could be registered with Zenith Gateway.
1. Call gateway_token_eligibility.
2. Summarise each criterion as pass, fail or needs review, with the evidence.
3. If it looks eligible, list what Zenith asks for in a registration request and what is still missing.`),
  );

  server.registerPrompt(
    "port_ethereum_app",
    {
      title: "Port an Ethereum app to Zenith",
      description: "Review an existing Solidity or dApp project for what changes on Zenith EVM.",
      argsSchema: { projectPath: z.string() },
    },
    ({ projectPath }) =>
      user(`Review the project at ${projectPath} for Zenith EVM.
1. Run zenith_check_compat on the contracts folder and on the front-end source.
2. Call zenith_project_config for the tooling the project uses (Foundry, Hardhat, viem or wagmi) and show the exact config changes.
3. List every change needed, most important first, and say which ones are safe to ignore.`),
  );
}
