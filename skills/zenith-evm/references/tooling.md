# Tooling

Validated: 2026-11-19. Sources: https://docs.zenith.network/zenith-testnet (Developer guides for EVM), https://explorer.testnet.zenith.network/api-docs.

## Foundry

```toml
[profile.default]
evm_version = "prague"

[rpc_endpoints]
zenith_testnet = "https://rpc.testnet.zenith.network/"

[etherscan]
zenith_testnet = { key = "unused", url = "https://explorer.testnet.zenith.network/api", chain = 936485 }
```

```sh
forge create src/Counter.sol:Counter --rpc-url zenith_testnet --private-key "$PRIVATE_KEY" --broadcast
forge verify-contract <ADDRESS> src/Counter.sol:Counter --verifier etherscan \
  --verifier-url https://explorer.testnet.zenith.network/api --etherscan-api-key unused --chain 936485
```

## Hardhat

- Hardhat 3: `chainDescriptors[936485].blockExplorers.etherscan = { name, url: "https://explorer.testnet.zenith.network", apiUrl: "https://explorer.testnet.zenith.network/api" }`, `verify.etherscan.apiKey = "unused"`. Use an up-to-date `@nomicfoundation/hardhat-verify` (around 3.0.6 it ignored `apiUrl`).
- Hardhat 2: `etherscan.customChains = [{ network: "zenith", chainId: 936485, urls: { apiURL, browserURL } }]`, `apiKey: { zenith: "unused" }`.
- Set `settings.evmVersion = "prague"`. Use chain ID 936485, never 1337/31337 (Hardhat refuses to verify against local chain IDs).
- `@wagmi/cli`'s etherscan plugin is hard-coded to etherscan.io; use its blockExplorer plugin.

## viem / wagmi

```ts
import { defineChain, createPublicClient, http } from "viem";
export const zenithTestnet = defineChain({
  id: 936485,
  name: "Zenith EVM Testnet",
  nativeCurrency: { name: "Zenith token", symbol: "ZTH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.zenith.network/"] } },
  blockExplorers: {
    default: {
      name: "Zenith Explorer",
      url: "https://explorer.testnet.zenith.network",
      apiUrl: "https://explorer.testnet.zenith.network/api",
    },
  },
  testnet: true,
});
const client = createPublicClient({
  chain: zenithTestnet,
  transport: http(undefined, { batch: { batchSize: 20 } }),
  pollingInterval: 2_000,
});
```

- Multicall3 is absent: wagmi `batch: { multicall: false }`; never set `chain.contracts.multicall3` to the canonical address.
- Watchers: `watchContractEvent({ ..., poll: true })`; filters do not exist.
- Receipts: `waitForTransactionReceipt({ hash, timeout: 120_000 })` (ethers v6: `tx.wait(1, 120_000)`). Never `confirmations > 1`.
- Logs: query ≤ 1,000 blocks per call, or the explorer's `module=logs&action=getLogs` for wide ranges.

## Wallets

MetaMask: chain ID `0xe4a25`, RPC `https://rpc.testnet.zenith.network/`, symbol ZTH, explorer `https://explorer.testnet.zenith.network` (no trailing slash). Remix: Injected Provider – MetaMask, or External HTTP Provider with the RPC URL.

## Keys

Testnet keys only, from environment or a secrets manager; never commit `.env`. Use a dedicated deployer with only the gas it needs.
