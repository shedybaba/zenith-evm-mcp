import type { Hex, PublicClient } from "viem";
import { loadNetwork, type ZenithNetwork } from "./config.js";
import { ExplorerClient } from "./explorer.js";
import { GatewayClient } from "./gateway.js";
import { JsonRpcClient, createZenithPublicClient } from "./rpc.js";

export interface SessionState {
  /** Gateway deployment seen first in this session; a change means the testnet was reset mid-session. */
  firstSeenDeploymentId?: Hex;
  /** Native value sent by write tools in this session, in wei. */
  spentWei: bigint;
}

export interface ZenithContext {
  network: ZenithNetwork;
  rpc: JsonRpcClient;
  client: PublicClient;
  explorer: ExplorerClient;
  gateway: GatewayClient;
  session: SessionState;
  env: NodeJS.ProcessEnv;
}

export function createContext(env: NodeJS.ProcessEnv = process.env): ZenithContext {
  const network = loadNetwork(env);
  const rpc = new JsonRpcClient(network.rpcUrl);
  return {
    network,
    rpc,
    client: createZenithPublicClient(network, rpc),
    explorer: new ExplorerClient(network.explorerUrl, network.explorerApiUrl),
    gateway: new GatewayClient(network.gatewayApiUrl),
    session: { spentWei: 0n },
    env,
  };
}
