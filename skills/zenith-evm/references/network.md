# Network

Validated: 2026-11-19 against the public testnet. Sources: https://docs.zenith.network/zenith-testnet (Network information, JSON-RPC, Explorer), https://explorer.testnet.zenith.network/api-docs.

## Endpoints

| Field                                   | Value                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Chain ID                                | 936485 (`0xe4a25`)                                                                                |
| RPC                                     | `https://rpc.testnet.zenith.network/` (Reth; standard `eth_*`, no custom public methods)          |
| Explorer                                | `https://explorer.testnet.zenith.network` (EIP-3091 paths: `/tx`, `/address`, `/block`, `/token`) |
| Explorer API                            | `https://explorer.testnet.zenith.network/api` (Etherscan-compatible + REST)                       |
| Faucet                                  | `https://explorer.testnet.zenith.network/faucet`                                                  |
| Gateway registry API                    | `https://gateway.testnet.zenith.network/v1` (`GET` it to list endpoints)                          |
| Gateway contract                        | `0x00000000000000000000000000000000000a7e00`                                                      |
| Synchronizer (Canton participants only) | `https://synchronizer.testnet.zenith.network:443`                                                 |
| Native currency                         | ZTH, 18 decimals                                                                                  |

## Faucet

1 ZTH per claim, one claim per GitHub account per rolling 24 h. Claims need a browser GitHub sign-in on the faucet page with an account created before the date in `GET /api/faucet` (`githubCreatedBefore`). Agents cannot claim; ask the user.

## Public RPC limits (per IP)

- 600 calls/min, 30 `eth_sendRawTransaction`/min, 4 in flight.
- Batches ≤ 20 calls; body ≤ 288 KiB; transaction ≤ 128 KiB encoded.
- `eth_getLogs` ≤ 1,000 blocks per call.
- No WebSocket, filters (`eth_newFilter`, `eth_getFilterChanges`, …) or subscriptions. Poll `eth_blockNumber` + `eth_getLogs`.
- CORS is open: browser dapps can call the RPC directly. The Gateway API does not send CORS headers; call it from a server.
- `eth_call` and `eth_estimateGas` accept state overrides. `eth_simulateV1` and `debug_*` are not allowed.

## Explorer API

- Etherscan modules: `account` (`txlist`, `tokentx`, `tokennfttx`, `balance`, `balancemulti`, `tokenbalance`; `txlistinternal` is always empty), `contract` (`getabi`, `getsourcecode`, `getcontractcreation`, `verifysourcecode`, `checkverifystatus`, `verifyproxycontract`), `logs.getLogs` (≤ 1,000 results, any block range), `proxy`, `stats`, `block`.
- Contract verification works (single file or standard-JSON input) even though the testnet docs' deploy table says otherwise. 30 verifications/hour/IP; any non-empty API key.
- REST: `/api/blocks`, `/api/transactions`, `/api/gas`, `/api/health`, `/api/faucet`, `/api/external-calls` (EVM transaction ↔ Canton update records, newest first), `/api/stream` (SSE: `evm:block`, `evm:transaction`).
- 10 requests/s per IP.

## Block production and finality

- Blocks only when there are transactions, in rounds of about 2 s; mainnet targets 1 s. An idle chain keeps the same block number: not a stall. Liveness signal: Gateway `GET /v1/health` → `producerProgressSecondsAgo`.
- Each block is built from submitted transactions and settled as one Canton transaction; validators re-execute it. A receipt means the block is final.
- Explorer dashboard latency (3–4 s) is submission → finality on the Canton test network.
- `/api/external-calls` records carry `cantonUpdateId`, `cantonCommandId`, `evmBlockNumber`, `participantsConfirmed/Total` and timestamps for each EVM transaction.
