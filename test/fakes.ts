import type { Address } from "viem";
import { TESTNET } from "../src/core/config.js";
import type { ZenithContext } from "../src/core/context.js";
import { checkPartyId } from "../src/core/party.js";
import type { PreflightFacts } from "../src/core/preflight.js";
import type { GatewayToken } from "../src/core/tokens.js";
import chain from "./fixtures/gateway-chain.json" with { type: "json" };

export const NS = "1220b64aeea8abe20728a6f60d66d6a57212ca9ba2f8d3b7a45bf8dd4de6932eeff2";
export const ALICE = `alice::${NS}`;
export const SENDER = "0x5a2D8970f687F1BCfEB522922c6E7FA4A683958C" as Address;
export const INBOX = "0x2E608CE4AF84308f54Cd85b78f92228a48C5B16C" as Address;
export const PARTY_CTX = { gatewayParty: chain.gatewayParty, protocolNamespace: chain.namespace };

export const ZTH: GatewayToken = {
  key: "ZTH",
  kind: "native",
  name: "Zenith token (native)",
  evm: { address: null, symbol: "ZTH", decimals: 18, isGatewayWrapper: false, deployed: true },
  canton: {
    admin: chain.native.registrar,
    instrumentId: chain.native.instrument.id,
    symbol: "wZTH",
    decimals: 10,
    registryUrl: "",
    oneEvmTokenEquals: "1.0",
  },
  toCanton: {
    route: "value transfer to inbox",
    recipientNeeds: null,
    amountRule: "multiple of 10^8 wei",
  },
  toEvm: { route: "mailbox", amountRule: "whole gwei" },
};

export const DEVUSD: GatewayToken = {
  key: "DevUSD",
  kind: "canton-original",
  name: "Dev USD",
  evm: {
    address: "0x4feb549aa9608fa13c2E9366Df7Dd38b267E0D46" as Address,
    symbol: "DUSD",
    decimals: 10,
    isGatewayWrapper: true,
    deployed: true,
  },
  canton: {
    admin: `devcc-admin::${NS}`,
    instrumentId: "DevUSD",
    symbol: "DevUSD",
    decimals: 10,
    registryUrl: "",
    oneEvmTokenEquals: "1.0",
  },
  toCanton: {
    route: "ERC-20 transfer to inbox",
    recipientNeeds: "a standing acceptance (transfer preapproval) at the DevUSD registry",
    amountRule: "any",
  },
  toEvm: { route: "mailbox", amountRule: "10 decimals" },
};

/** Facts for a send that passes every check; each footgun test changes one thing. */
export function goodFacts(over: Partial<PreflightFacts> = {}): PreflightFacts {
  const party = checkPartyId(ALICE, PARTY_CTX);
  return {
    input: { partyId: ALICE, token: "ZTH", amount: "0.5", from: SENDER },
    party,
    token: ZTH,
    unregisteredAddress: false,
    amountBase: 5n * 10n ** 17n,
    amountError: null,
    inbox: {
      party,
      inbox: INBOX,
      deployed: true,
      known: true,
      knownEvidence: "The inbox is deployed.",
      api: { address: INBOX, deployed: true },
      apiMatches: true,
      notes: [],
    },
    reset: {
      status: "unchanged",
      current: {
        deploymentId: chain.deploymentId as `0x${string}`,
        genesisHash: chain.genesisHash as `0x${string}`,
      },
      baseline: {
        deploymentId: chain.deploymentId as `0x${string}`,
        genesisHash: chain.genesisHash as `0x${string}`,
        validatedOn: "2026-11-19",
      },
      changes: [],
      advice: null,
    },
    sender: { address: SENDER, isContract: false, nativeBalance: 10n ** 18n, tokenBalance: null },
    gasPrice: 1_000_000_000n,
    dryRun: { ok: true, gas: 21_000n },
    transaction: { to: INBOX, value: 5n * 10n ** 17n, data: "0x" },
    ...over,
  };
}

/** A context whose network calls are replaced by the given stubs. */
export function fakeContext(stubs: {
  client?: Record<string, unknown>;
  rpc?: Record<string, unknown>;
  gateway?: Record<string, unknown>;
  explorer?: Record<string, unknown>;
}): ZenithContext {
  return {
    network: TESTNET,
    client: stubs.client ?? {},
    rpc: stubs.rpc ?? {},
    gateway: stubs.gateway ?? {},
    explorer: {
      txUrl: (h: string) => `x/tx/${h}`,
      addressUrl: (a: string) => `x/address/${a}`,
      ...stubs.explorer,
    },
    session: { spentWei: 0n },
    env: {},
  } as unknown as ZenithContext;
}
