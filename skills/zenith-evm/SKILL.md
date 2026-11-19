---
name: zenith-evm
description: Build, deploy, verify, debug and review Solidity applications on Zenith EVM, the Ethereum-compatible execution environment of the Canton Network (testnet chain 936485), and move tokens safely between Zenith EVM and Canton with Zenith Gateway. Use when a task mentions Zenith, Zenith EVM, Zenith Gateway, ZTH/wZTH, chain 936485, Canton parties receiving EVM tokens, inbox or mailbox parties, or porting an Ethereum app to Canton through Zenith.
---

# Zenith EVM

## Workflow

1. Classify intent. Explain/review/diagnose: read only. Deploy/send: simulate first, show the plan, act only after the user confirms. Port: scan, then change.
2. Identify the network. Zenith EVM Testnet is chain 936485, RPC `https://rpc.testnet.zenith.network/`. Never sign for another chain from a Zenith task.
3. If the `zenith-evm-mcp` tools are available, use them instead of hand-rolled RPC calls (map below). They enforce the RPC limits and the Gateway checklist.
4. Load only the references that apply, completely:
   - Endpoints, faucet, RPC/explorer limits, block production, resets: [network.md](references/network.md)
   - Writing, porting or reviewing Solidity or dApp code: [differences.md](references/differences.md) + [tooling.md](references/tooling.md)
   - Any token movement between Zenith EVM and Canton, inbox/mailbox parties, wZTH, token registration: [gateway.md](references/gateway.md) + network
   - Unexpected state, vanished balances, nonces at 0, changed synchronizer ID: [resets.md](references/resets.md)

Scope: Zenith EVM and Gateway from the EVM side. For Daml models, Canton participants and `externalCall`, use a Daml skill.

## Core invariants

- A receipt is final. Each EVM block settles as one Canton transaction; there are no reorgs and no confirmations to wait for. Always wait with a timeout (blocks are only made when there are transactions).
- Blocks are produced on demand. An unchanged block number is not a stall, and `block.number` is not a clock: use `block.timestamp`.
- The chain runs Prague. Compile with `evmVersion: "prague"`; recent solc defaults to Osaka, whose opcodes (for example CLZ) fail with `NotActivated`.
- `block.prevrandao` is not Beacon Chain randomness. Blob transactions are unsupported.
- The public RPC has no WebSockets, filters or subscriptions; `eth_getLogs` spans at most 1,000 blocks; 600 calls/min, 4 in flight, batches ≤ 20 per IP. Poll.
- Multicall3, Permit2, CreateX and the ERC-4337 EntryPoint are not deployed on testnet. Safe 1.3.0/1.4.1 and the CREATE2 deployer `0x4e59b44847b379578588920ca78fbf26c0b4956c` are.
- Gateway sends lose tokens when the recipient is wrong. Before any send to a Canton party, run every check in gateway.md (or `gateway_preflight`). Never send to an inbox from inside a contract call.
- Testnet only: never move anything of real value through Gateway.

## Terminology across the boundary

- Canton `Party` (`hint::1220<64 hex>`) is a ledger identity, not an address. Its **inbox** is the EVM address (computed by `inboxOf(party)` on the Gateway contract `0x00000000000000000000000000000000000a7e00`) that delivers EVM tokens to that party on Canton.
- A **mailbox party** (`m-…`) is the Canton party that stands for one EVM address and one instrument; a CIP-56 transfer to it moves that instrument to that EVM address. `r-…` (registrar) and `b-…` (backing) are also protocol parties. Never use any of them as a recipient party.
- A **crossing** is one atomic Canton transaction that moves value and commits the EVM block together. A pending offer is not a crossing.
- The Canton **update ID** is the settlement identity of the EVM block containing a transaction; it is separate from the EVM transaction hash.

## Tool map (zenith-evm-mcp)

| Need                                                                 | Tool                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Network facts, health (idle vs down, resets)                         | `zenith_network_info`, `zenith_health`                                                                     |
| Address, transaction (with Canton update), view call, logs, decoding | `zenith_get_account`, `zenith_get_transaction`, `zenith_read_contract`, `zenith_get_logs`, `zenith_decode` |
| Gateway tokens, inboxes, mailboxes, amounts                          | `gateway_tokens`, `gateway_inbox`, `gateway_mailbox`, `gateway_convert`                                    |
| Before sending to Canton / after                                     | `gateway_preflight` / `gateway_deposit_status`                                                             |
| Gateway history, token registration pre-screen                       | `gateway_activity`, `gateway_token_eligibility`                                                            |
| Porting and tooling                                                  | `zenith_check_compat`, `zenith_project_config`, `zenith_verify_contract`                                   |
| Deploy, send (opt-in, testnet key required)                          | `zenith_deploy`, `zenith_send`                                                                             |

## Before finishing

Re-check: chain ID, `evmVersion`, receipt timeouts, polling instead of filters, no `block.number` timing, no dependency on missing contracts, and for every Gateway send a full party ID, a registered token, the right units, a direct transfer and a passing preflight. Report the exact checks run and anything not verified.
