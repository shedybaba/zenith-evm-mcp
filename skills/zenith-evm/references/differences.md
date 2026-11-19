# Differences from Ethereum

Validated: 2026-11-19. Sources: https://docs.zenith.network/zenith-testnet (Differences from Ethereum Mainnet, Deploy smart contracts, Concepts and architecture); items marked _(observed)_ were confirmed against the public testnet.

## Same

Bytecode and opcodes up to Prague, Solidity, ABI encoding, EVM logs, receipts, nonces, standard transaction signing, gas semantics (paid in ZTH), ERC standards, MetaMask/Foundry/Hardhat/Remix/ethers/viem/web3.js.

## Different

| Area              | Zenith EVM                                                                              | What to do                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Finality          | Deterministic via Canton, seconds, no reorgs                                            | Wait for one receipt, with a timeout; never for N confirmations                           |
| Block production  | On demand, only with transactions                                                       | Never measure time in blocks; use `block.timestamp`                                       |
| Hard fork         | Prague from genesis. Osaka opcodes fail: `CLZ` → `EVM error: NotActivated` _(observed)_ | Compile with `evmVersion: "prague"`. solc ≥ 0.8.31 defaults to Osaka _(observed: 0.8.39)_ |
| Randomness        | `PREVRANDAO` set by Zenith's block building                                             | Do not use it for randomness; use an oracle or commit-reveal                              |
| Blobs             | EIP-4844 unsupported                                                                    | No blob transactions, no `blobhash` logic                                                 |
| Consensus         | Canton validators; no staking, no Beacon Chain                                          | Do not rely on validator-selection semantics                                              |
| Fees              | Standard EVM gas on testnet; mainnet adds a Canton fee element                          | Keep fee logic configurable                                                               |
| Explorer metadata | EVM data + Canton update                                                                | Trace with the update ID when debugging settlement                                        |
| Interop           | Gateway: atomic Canton ↔ EVM token transfers (Daml ↔ EVM calls planned)                 | See gateway.md                                                                            |

## Contracts on testnet _(observed)_

| Contract                    | Canonical address                            | Present |
| --------------------------- | -------------------------------------------- | ------- |
| CREATE2 deployer (Arachnid) | `0x4e59b44847b379578588920ca78fbf26c0b4956c` | yes     |
| Safe 1.4.1 singleton        | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | yes     |
| Safe 1.4.1 proxy factory    | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | yes     |
| Safe 1.3.0 singleton        | `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` | yes     |
| Multicall3                  | `0xcA11bde05977b3631167028862bE2a173976CA11` | **no**  |
| Permit2                     | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | **no**  |
| CreateX                     | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | **no**  |
| ERC-4337 EntryPoint v0.7    | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **no**  |

Consequences: viem/wagmi multicall batching fails (disable `batch.multicall` or deploy your own and set `chain.contracts.multicall3`); Permit2-based routers and 4337 wallets need their own deployments.

## Oracle

Kaiko's Data On-Ramp oracle (request-response and pull) is live on testnet. Integration details: kaiko.com/data-infrastructure/data-on-ramp.
