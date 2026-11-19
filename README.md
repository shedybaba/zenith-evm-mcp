# zenith-evm-mcp

**Give any AI assistant safe, Zenith-aware superpowers.** An [MCP](https://modelcontextprotocol.io) server and agent skill for [Zenith EVM](https://zenith.network), the Ethereum-compatible execution environment of the Canton Network.

It lets Claude, Cursor, VS Code, Windsurf or any MCP client read Zenith, trace a transaction from EVM to the Canton update that settled it, check every Gateway send against Zenith's own "Before you send" checklist, verify contracts, and (only if you opt in) deploy and send on testnet.

> Community-built and open source. Not an official Zenith product. Testnet only: never move anything of real value through Gateway.

## Why

Zenith Gateway moves tokens between Zenith EVM and Canton atomically, and the docs warn many times that a wrong recipient loses tokens for good: a shortened party ID, a protocol party, an unregistered token, a send from inside a contract, a ZTH amount that is not a multiple of 10^8 wei. An AI agent following generic Ethereum habits will walk straight into these.

This server turns every one of those warnings into a check the agent cannot skip, and adds the Zenith-specific knowledge ordinary EVM tooling lacks.

```text
> gateway_preflight  partyId=alice::1220abab…ab  token=ZTH  amount=0.5  from=0x5a2d…958c

BLOCKED: do not send. Failed: "Gateway knows the recipient party".
✓ Recipient is a full party ID (hint::1220<64 hex>)
✓ Recipient is not a Zenith protocol party or the Gateway party
✓ Token is registered with Gateway
✓ Amount is a valid positive number
✓ ZTH value is a multiple of 10^8 wei
· Inbox address agrees with the Gateway registry
✗ Gateway knows the recipient party
✓ Sent directly from a wallet, not through a contract
✓ Sender has enough balance
✓ The Zenith RPC accepts this exact transaction (eth_estimateGas)
✓ No testnet reset since this tool's baseline
```

That party ID is well formed and the network itself would accept the transfer, but no such party exists, so the ZTH would never arrive. The preflight catches it.

## Findings from validating against the testnet

Everything below was checked against the public testnet (chain 936485) and is built into the tools and the skill.

| Finding                                                                                                                                                                                                                                            | What the toolkit does                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| solc ≥ 0.8.31 compiles for **Osaka** by default; Zenith runs **Prague**, and Osaka's `CLZ` fails on-chain with `EVM error: NotActivated`.                                                                                                          | Compiles for Prague, flags Osaka targets in `foundry.toml`/Hardhat configs and Osaka opcodes in bytecode.                         |
| The registry API cannot tell a mistyped party from a real one until its inbox is deployed, but the RPC's deposit guard can: a 1 wei `eth_estimateGas` to a known party's inbox is refused ("is a gateway inbox"), and accepted for an unknown one. | `gateway_preflight` and `gateway_inbox` use this to confirm Gateway knows the recipient. Nothing is ever sent.                    |
| The Gateway contract is unverified. Its events were matched by topic hash: `Collected`, `NativeCollected`, `Minted`, `Released`, `MetadataSet`, `WrapperRegistered`, `OriginalRegistered`.                                                         | Decodes Gateway activity, confirms deposits were credited, and lists crossings per token.                                         |
| The explorer's Etherscan-compatible API verifies contracts (the deploy guide's table says verification is not supported).                                                                                                                          | `zenith_verify_contract` and `zenith_deploy` verify with the exact standard-JSON input.                                           |
| Multicall3, Permit2, CreateX and the ERC-4337 EntryPoint are not deployed; Safe 1.3.0/1.4.1 and the CREATE2 deployer are.                                                                                                                          | Flags dependencies on missing contracts; generated viem/wagmi config disables multicall batching.                                 |
| `eth_call` accepts state overrides; `eth_simulateV1` and `debug_*` are not allowed.                                                                                                                                                                | The token pre-screen runs a probe contract at a real holder's address inside `eth_call` to measure exactly what a transfer moves. |

## What it catches

Each row is a named test in [`test/footguns`](test/footguns), traced to the docs section it comes from.

| Docs warning                                                                                              | Result                                                          |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Shortened party ID (hint without `::namespace`, or a console's `…` display)                               | Blocked                                                         |
| Protocol party (`m-`, `r-`, `b-`) or the Gateway party as recipient                                       | Blocked                                                         |
| Well-formed party that Gateway does not know                                                              | Blocked                                                         |
| Token not in `/v1/registries`                                                                             | Blocked                                                         |
| ZTH not a multiple of 10^8 wei                                                                            | Blocked, with the nearest sendable amount                       |
| wZTH back to EVM not in whole gwei; Canton amount with > 10 decimals                                      | Refused, never rounded                                          |
| Wrapper of a Canton token to a party without a standing acceptance                                        | Blocked, with the network's own -32003 reason and the fix       |
| Sending from a contract (router, multicall, smart wallet)                                                 | Warned: the RPC only checks a transaction's own call            |
| Testnet reset (stored inboxes become invalid)                                                             | Warned on every preflight and health check                      |
| Deposit held by Gateway, or evicted after ~10 minutes                                                     | Explained, with "do not resend" or the exact nonce to resend at |
| `eth_getLogs` over more than 1,000 blocks                                                                 | Chunked automatically                                           |
| An idle chain mistaken for a stalled one                                                                  | Reported as idle, using Gateway's producer progress             |
| Fee-on-transfer, rebasing, blocklist, hook or upgradeable tokens submitted for registration               | Flagged by the eligibility pre-screen                           |
| `block.number` as a clock, `prevrandao` randomness, blob opcodes, many confirmations, WebSockets, filters | Flagged by `zenith_check_compat`                                |

## Quick start

Requires Node.js 20 or later.

```bash
npx -y github:shedybaba/zenith-evm-mcp --doctor
```

`--doctor` checks the RPC, explorer, Gateway and faucet, and whether write tools are enabled.

### Add it to your AI app

**Claude Code**

```bash
claude mcp add zenith -- npx -y github:shedybaba/zenith-evm-mcp
```

**Claude Desktop, Cursor and Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "zenith": { "command": "npx", "args": ["-y", "github:shedybaba/zenith-evm-mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "zenith": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:shedybaba/zenith-evm-mcp"]
    }
  }
}
```

More in [`examples/`](examples). Then ask things like:

- "Is Zenith healthy right now?"
- "Trace 0x… and show me the Canton update that settled it."
- "I want to send 2 DevUSD to `alice::1220…`. Is that safe?"
- "Check my project for anything that behaves differently on Zenith."
- "Could this ERC-20 be registered with Gateway?"

## Tools

Full reference: [`docs/tools.md`](docs/tools.md) (generated from the code).

| Area               | Tools                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network            | `zenith_network_info`, `zenith_health`                                                                                                                                  |
| Chain and explorer | `zenith_get_account`, `zenith_get_transaction`, `zenith_read_contract`, `zenith_get_logs`, `zenith_decode`                                                              |
| Gateway            | `gateway_tokens`, `gateway_inbox`, `gateway_preflight`, `gateway_deposit_status`, `gateway_mailbox`, `gateway_convert`, `gateway_activity`, `gateway_token_eligibility` |
| Developer          | `zenith_check_compat`, `zenith_project_config`, `zenith_verify_contract`                                                                                                |
| Write (opt-in)     | `zenith_deploy`, `zenith_send`                                                                                                                                          |

**Resources:** `zenith://network`, `zenith://limits`, `zenith://gateway/tokens`, `zenith://gateway/checklist`, `zenith://differences`.
**Prompts:** `deploy_and_verify`, `send_to_canton_safely`, `investigate_missing_deposit`, `audit_token_for_gateway`, `port_ethereum_app`.

## Write tools (opt-in)

`zenith_deploy` and `zenith_send` are disabled unless you give the server a **testnet-only** key:

```bash
mkdir -p ~/.config/zenith-evm-mcp
printf 'ZENITH_PRIVATE_KEY=0x<testnet key>\n' > ~/.config/zenith-evm-mcp/testnet.env
chmod 600 ~/.config/zenith-evm-mcp/testnet.env
```

Then add `"env": { "ZENITH_KEY_FILE": "~/.config/zenith-evm-mcp/testnet.env" }` to the server's config. Fund the address with ZTH from the [faucet](https://explorer.testnet.zenith.network/faucet).

Guards:

- Refuses to sign unless the RPC reports chain 936485.
- Simulates first and only sends when called again with `confirm: true`.
- Per-session spend cap (`ZENITH_SPEND_CAP_ZTH`, default 1 ZTH).
- Sends to a Canton party go through `gateway_preflight`, and blocked sends are refused. A plain send to a Gateway inbox is refused, so the checks cannot be bypassed.
- `zenith_deploy` compiles `.sol` files for Prague, refuses bytecode with unsupported opcodes, and verifies the source automatically.

## Agent skill

[`skills/zenith-evm`](skills/zenith-evm) is a standalone agent skill: workflow, core invariants and references for the network, the differences from Ethereum, Gateway, tooling and resets. It is useful even without the server. Copy the folder into your agent's skills directory (for Claude Code, `~/.claude/skills/zenith-evm`). It follows the same layout as Zenith's own [`daml-skill`](https://github.com/zenith-network/daml-skill), covering the EVM and Gateway side.

## Using it as a library

```ts
import { createContext, checkPartyId, loadGatewayTokens } from "zenith-evm-mcp";

const ctx = createContext();
console.log(checkPartyId("alice").issues[0]?.message);
console.log((await loadGatewayTokens(ctx)).map((t) => t.key));
```

## How it works

- `src/core`: plain TypeScript, no MCP. Rate-limited JSON-RPC client (600 calls/min, 4 in flight, batches of 20, retries), explorer and Gateway API clients, party and unit rules, preflight, deposit tracking, eligibility probe, compiler, compatibility scanner.
- `src/tools`: thin MCP wrappers with zod-validated inputs and structured JSON outputs.
- Preflight separates gathering facts (network calls) from evaluating rules (pure functions), so every rule is unit-tested offline.

## Development

```bash
npm install
npm run check          # typecheck, lint, format, offline tests
npm run test:live      # read-only tests against the public testnet
npm run test:live:write  # deploy → verify → trace → call (needs ZENITH_KEY_FILE with faucet ZTH)
npm run docs           # regenerate docs/tools.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT © shedybaba. Built by [shedybaba](https://github.com/shedybaba).
