import type { ZenithNetwork } from "./config.js";
import { ZENITH_EVM_VERSION } from "./solidity.js";

export type ToolName = "foundry" | "hardhat3" | "hardhat2" | "viem" | "wagmi" | "metamask" | "env";

/** Ready-to-paste configuration for common EVM tooling, set up for Zenith (including contract verification). */
export function projectConfig(n: ZenithNetwork, tools: ToolName[]) {
  const all: Record<ToolName, { file: string; content: string; notes: string[] }> = {
    foundry: {
      file: "foundry.toml",
      content: `[profile.default]
evm_version = "${ZENITH_EVM_VERSION}"

[rpc_endpoints]
zenith_testnet = "${n.rpcUrl}"

[etherscan]
zenith_testnet = { key = "unused", url = "${n.explorerApiUrl}", chain = ${n.chainId} }

# Deploy and verify:
#   forge create src/Counter.sol:Counter --rpc-url zenith_testnet --private-key $PRIVATE_KEY --broadcast
#   forge verify-contract <ADDRESS> src/Counter.sol:Counter --verifier etherscan --verifier-url ${n.explorerApiUrl} --etherscan-api-key unused --chain ${n.chainId}`,
      notes: [
        `evm_version = "${ZENITH_EVM_VERSION}": Zenith runs Prague; recent solc releases default to Osaka, whose opcodes fail with "NotActivated".`,
        "The explorer accepts any non-empty API key.",
      ],
    },
    hardhat3: {
      file: "hardhat.config.ts",
      content: `import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: { version: "0.8.30", settings: { evmVersion: "${ZENITH_EVM_VERSION}", optimizer: { enabled: true, runs: 200 } } },
  networks: {
    zenithTestnet: { type: "http", url: "${n.rpcUrl}", chainId: ${n.chainId}, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
  },
  chainDescriptors: {
    ${n.chainId}: {
      name: "Zenith",
      blockExplorers: { etherscan: { name: "Zenith Explorer", url: "${n.explorerUrl}", apiUrl: "${n.explorerApiUrl}" } },
    },
  },
  verify: { etherscan: { apiKey: "unused" } },
};

export default config;`,
      notes: [
        "Needs an up-to-date @nomicfoundation/hardhat-verify; around 3.0.6 it ignored the custom apiUrl.",
      ],
    },
    hardhat2: {
      file: "hardhat.config.js",
      content: `module.exports = {
  solidity: { version: "0.8.30", settings: { evmVersion: "${ZENITH_EVM_VERSION}" } },
  networks: {
    zenith: { url: "${n.rpcUrl}", chainId: ${n.chainId}, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
  },
  etherscan: {
    apiKey: { zenith: "unused" },
    customChains: [{ network: "zenith", chainId: ${n.chainId}, urls: { apiURL: "${n.explorerApiUrl}", browserURL: "${n.explorerUrl}" } }],
  },
};`,
      notes: [
        "Use chain ID 936485, never 1337/31337: Hardhat refuses to verify against local chain IDs.",
      ],
    },
    viem: {
      file: "zenith.ts",
      content: `import { createPublicClient, defineChain, http } from "viem";

export const zenithTestnet = defineChain({
  id: ${n.chainId},
  name: "${n.name}",
  nativeCurrency: { name: "Zenith token", symbol: "ZTH", decimals: 18 },
  rpcUrls: { default: { http: ["${n.rpcUrl}"] } },
  blockExplorers: { default: { name: "Zenith Explorer", url: "${n.explorerUrl}", apiUrl: "${n.explorerApiUrl}" } },
  testnet: true,
});

export const client = createPublicClient({
  chain: zenithTestnet,
  // Multicall3 is not deployed on Zenith testnet, so keep multicall batching off.
  // JSON-RPC batches are allowed (at most 20 calls each).
  transport: http(undefined, { batch: { batchSize: 20 } }),
  pollingInterval: 2_000,
});

// Watchers must poll: the public RPC has no filters, subscriptions or WebSockets.
// client.watchContractEvent({ ..., poll: true });`,
      notes: [
        "Receipts are final: wait for one, with a timeout. Waiting for more confirmations can hang because blocks are only made when there are transactions.",
      ],
    },
    wagmi: {
      file: "wagmi.config.ts",
      content: `import { createConfig, http } from "wagmi";
import { zenithTestnet } from "./zenith";

export const config = createConfig({
  chains: [zenithTestnet],
  transports: { [zenithTestnet.id]: http(undefined, { batch: { batchSize: 20 } }) },
  batch: { multicall: false },
  pollingInterval: 2_000,
});`,
      notes: [
        "useReadContracts relies on multicall; with Multicall3 missing it falls back to individual calls when batch.multicall is false.",
      ],
    },
    metamask: {
      file: "wallet_addEthereumChain params",
      content: JSON.stringify(
        {
          chainId: `0x${n.chainId.toString(16)}`,
          chainName: n.name,
          nativeCurrency: { name: "Zenith token", symbol: "ZTH", decimals: 18 },
          rpcUrls: [n.rpcUrl],
          blockExplorerUrls: [n.explorerUrl],
        },
        null,
        2,
      ),
      notes: [
        "Use the explorer URL without a trailing slash; it serves EIP-3091 paths (/tx, /address, /block, /token).",
      ],
    },
    env: {
      file: ".env.example",
      content: `ZENITH_RPC_URL=${n.rpcUrl}
ZENITH_CHAIN_ID=${n.chainId}
ZENITH_EXPLORER_API=${n.explorerApiUrl}
# Testnet-only key. Never commit a real .env file.
PRIVATE_KEY=`,
      notes: [`Get ZTH for gas at ${n.faucetUrl}.`],
    },
  };
  const selected = tools.length ? tools : (Object.keys(all) as ToolName[]);
  return Object.fromEntries(selected.map((t) => [t, all[t]]));
}
