import { DOC_LINKS, LIMITS } from "./core/config.js";

export const SERVER_INSTRUCTIONS = `Tools for Zenith EVM, the Ethereum-compatible execution environment of the Canton Network (testnet, chain 936485).

Key facts:
- Standard Ethereum JSON-RPC, Solidity and tooling work unchanged. Each EVM block settles as one Canton transaction, so a receipt is final: no confirmations, no reorgs.
- Blocks are produced only when there are transactions. An unchanged block number is not a stall; use zenith_health.
- The public RPC has no WebSockets, filters or subscriptions, and eth_getLogs covers at most ${LIMITS.rpcMaxLogRange} blocks; zenith_get_logs handles this.
- Gateway moves tokens between Zenith EVM and Canton. Before sending anything to a Canton party, ALWAYS run gateway_preflight. Tokens sent to a wrong inbox are lost for good.
- Write tools (zenith_deploy, zenith_send) only work when the user configured a testnet key, and they refuse any chain other than Zenith testnet.`;

export const GATEWAY_CHECKLIST = `# Zenith Gateway: before you send

These rules come from the Zenith testnet docs (${DOC_LINKS.beforeYouSend}). \`gateway_preflight\` checks every one of them automatically.

1. **The token must be registered.** Only tokens listed in GET /v1/registries can cross. An unregistered ERC-20 sent to an inbox from inside a contract call stays there for good.
2. **Use the full party ID** (\`hint::1220<64 hex>\`). A shortened ID gives the inbox of an ID no party can have; tokens sent there are lost.
3. **Never send to the inbox of a Zenith protocol party** (IDs starting with \`m-\`, \`r-\` or \`b-\`) **or of the Gateway party.** Gateway never credits them.
4. **Send directly from a wallet**, as a plain ERC-20 \`transfer\` or a plain ZTH value transfer. The RPC only checks the transaction's own call; a transfer made inside a router or multicall is not refused.
5. **Mind the units.** ZTH sent to an inbox must be a multiple of 10^8 wei. wZTH sent back must be a whole number of gwei. Gateway-issued tokens have 10 decimals, and Canton amounts have at most 10 decimal places.
6. **Wrappers of Canton tokens need a standing acceptance.** Sending the DevUSD wrapper (or another Gateway ERC-20 of a Canton token) back to Canton needs the recipient to have a standing acceptance with that token's registry; otherwise the RPC refuses the transaction (-32003).
7. **Use the mailbox for the exact token** when sending from Canton to Zenith EVM, and only once it is active. Keep \`executeBefore\` at least 180 seconds in the future.
8. **After a testnet reset, look up every stored inbox again.** Tokens sent to an inbox computed for an earlier deployment are lost.
9. **Never wait for a receipt forever.** A deposit Gateway cannot deliver yet is held, not mined, and evicted after about 10 minutes together with later transactions from the same address. Check GET /v1/pending/evm/<tx hash> (\`gateway_deposit_status\`).
`;

export const DIFFERENCES = `# Zenith EVM vs Ethereum mainnet

Source: ${DOC_LINKS.differences}

| Area | Zenith EVM |
|---|---|
| Execution | Reth-based; same opcodes and bytecode. Prague active from genesis. |
| Finality | Deterministic within seconds, through Canton. No reorgs; a receipt is final. |
| Block production | On demand (rounds of ~2 s) only when there are transactions. Do not time things with block.number. |
| Randomness | PREVRANDAO is set by Zenith's block building, not the Beacon Chain. Do not use it for randomness. |
| Blobs | EIP-4844 blob transactions are not supported. |
| RPC | Standard eth_* methods; no WebSockets, filters or subscriptions; eth_getLogs ≤ ${LIMITS.rpcMaxLogRange} blocks; ${LIMITS.rpcCallsPerMinute} calls/min, ${LIMITS.rpcMaxInFlight} in flight, batches ≤ ${LIMITS.rpcMaxBatch} per IP. |
| Gas | Standard EVM gas, paid in ZTH. Mainnet gas will include a Canton fee element. |
| Interop | Gateway moves tokens atomically between Canton and Zenith EVM (contract calls between Daml and EVM are planned). |
| Explorer | Each EVM transaction links to the Canton update that settled it. Etherscan-compatible API, including contract verification. |
| Common contracts | Safe 1.3.0/1.4.1 and the CREATE2 deployer (0x4e59…956c) exist; Multicall3, Permit2, CreateX and ERC-4337 EntryPoint are not deployed on testnet. |
`;
