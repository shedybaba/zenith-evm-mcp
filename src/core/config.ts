import type { Address, Hex } from "viem";

export interface ZenithNetwork {
  id: "testnet";
  name: string;
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
  gatewayApiUrl: string;
  faucetUrl: string;
  synchronizerUrl: string;
  docsUrl: string;
  gatewayAddress: Address;
}

export const TESTNET: ZenithNetwork = {
  id: "testnet",
  name: "Zenith EVM Testnet",
  chainId: 936485,
  nativeSymbol: "ZTH",
  nativeDecimals: 18,
  rpcUrl: "https://rpc.testnet.zenith.network/",
  explorerUrl: "https://explorer.testnet.zenith.network",
  explorerApiUrl: "https://explorer.testnet.zenith.network/api",
  gatewayApiUrl: "https://gateway.testnet.zenith.network",
  faucetUrl: "https://explorer.testnet.zenith.network/faucet",
  synchronizerUrl: "https://synchronizer.testnet.zenith.network:443",
  docsUrl: "https://docs.zenith.network/zenith-testnet",
  gatewayAddress: "0x00000000000000000000000000000000000a7e00",
};

/** Network settings, with optional overrides for self-hosted endpoints. */
export function loadNetwork(env: NodeJS.ProcessEnv = process.env): ZenithNetwork {
  const explorerUrl = trimSlash(env.ZENITH_EXPLORER_URL ?? TESTNET.explorerUrl);
  return {
    ...TESTNET,
    rpcUrl: env.ZENITH_RPC_URL ?? TESTNET.rpcUrl,
    explorerUrl,
    explorerApiUrl: `${explorerUrl}/api`,
    faucetUrl: `${explorerUrl}/faucet`,
    gatewayApiUrl: trimSlash(env.ZENITH_GATEWAY_API_URL ?? TESTNET.gatewayApiUrl),
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Values observed on the public testnet when this release was validated.
 * A mismatch at runtime means the testnet was most likely reset.
 */
export const BASELINE = {
  validatedOn: "2026-11-19",
  genesisHash: "0x68958e6b7559f7ad42b3291ee647e5286a1e94d23d0473c4b5cb34ac654d09e2" as Hex,
  deploymentId: "0x64c9a5594fdc9ca81066357699ac446bee6936b5a7f52c88238ddfbb82ac0979" as Hex,
  synchronizerId: "devnet::1220f065e594bd15767f61b6ba49da0c1310ba000821b0f0fbb67c1cfe80dbf9acf2",
} as const;

/** Public endpoint limits published in the Zenith docs and explorer API docs. */
export const LIMITS = {
  rpcCallsPerMinute: 600,
  rpcSendRawPerMinute: 30,
  rpcMaxInFlight: 4,
  rpcMaxBatch: 20,
  rpcMaxLogRange: 1000,
  rpcMaxTxBytes: 128 * 1024,
  explorerRequestsPerSecond: 10,
  explorerVerificationsPerHour: 30,
  explorerMaxLogs: 1000,
} as const;

/** Canton amounts are Numeric(10). */
export const CANTON_DECIMALS = 10;
/** Native ZTH crosses to Canton in multiples of 10^8 wei (one wZTH unit). */
export const ZTH_QUANTUM_WEI = 10n ** 8n;
/** wZTH crosses back to Zenith EVM in whole gwei. */
export const WZTH_QUANTUM_WEI = 10n ** 9n;
/** Mailbox offers need an executeBefore at least this far in the future. */
export const MIN_EXECUTE_BEFORE_SECONDS = 180;
/** Gateway evicts a held deposit after roughly this long. */
export const HELD_DEPOSIT_EVICTION_MINUTES = 10;

const DOCS = TESTNET.docsUrl;
export const DOC_LINKS = {
  beforeYouSend: `${DOCS}#gateway-troubleshooting`,
  commonProblems: `${DOCS}#gateway-troubleshooting`,
  transferDirections: `${DOCS}#zenith-gateway-overview`,
  amounts: `${DOCS}#interacting-with-gateway`,
  workflows: `${DOCS}#gateway-sample-workflows`,
  fromApplication: `${DOCS}#using-gateway-from-your-application`,
  registerToken: `${DOCS}#zenith-gateway-overview`,
  jsonRpc: `${DOCS}#json-rpc`,
  differences: `${DOCS}#differences-from-ethereum-mainnet`,
  deploy: `${DOCS}#deploy-smart-contracts`,
  networkInfo: `${DOCS}#network-information`,
  explorer: `${DOCS}#explorer`,
  architecture: `${DOCS}#concepts-and-architecture`,
} as const;
