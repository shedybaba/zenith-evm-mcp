import type { Address, Hex } from "viem";
import { fetchJson } from "./http.js";

export interface InstrumentRef {
  admin: string;
  id: string;
}

export interface GatewayChainInfo {
  deploymentId: Hex;
  evmChainId: number;
  gatewayAddress: Address;
  gatewayParty: string;
  genesisHash: Hex;
  namespace: string;
  sinkAddress: Address;
  native: {
    genesisSupplyWei: string;
    instrument: InstrumentRef;
    mode: string;
    registrar: string;
  };
  offers: { minExecuteBeforeSeconds: number };
  derivation?: unknown;
}

export interface RegistryInstrument {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  class?: string;
  credentials?: string;
  supportedApis?: Record<string, number>;
}

export interface Registry {
  kind: string;
  admin: string;
  baseUrl: string;
  instruments: RegistryInstrument[];
  token?: Address;
  evm?: { native?: string; sink?: Address; erc20Decimals?: number; token?: Address; unit?: string };
  acceptanceRules?: { contractId: string; templateId: string; synchronizerId: string };
  factory?: string;
  senderPackages?: { id?: string; name: string; version?: string }[];
}

export interface Registries {
  registries: Registry[];
  externalRegistries: Registry[];
}

export interface InboxInfo {
  address: Address | null;
  deployed: boolean;
  gateway: Address;
  initCodeHash: Hex;
  kind: "inbox";
  note?: string;
  party: string;
  preimage: Hex | null;
  salt: Hex | null;
}

export interface PendingState {
  id: string;
  kind: "evm" | "canton";
  state: string;
  reason: string | null;
  since: string | null;
  nextAttempt: string | null;
  evictAt: string | null;
}

export interface DerivedParty {
  kind: string;
  party?: string;
  hint?: string;
  eligible: boolean | null;
  custody?: string;
  namespace?: string;
  inputs?: unknown;
  status?: string;
  reason?: string;
}

export interface ProtocolPartyState extends DerivedParty {
  state: string;
  observedAt: string | null;
  since: string | null;
  request: unknown;
}

export interface DerivedAddress {
  address: Address;
  kind: string;
  initCodeHash: Hex;
  gateway: Address;
}

export interface GatewayHealth {
  ok: boolean;
  ready: boolean;
  core: string;
  ledger: string;
  producer: string;
  synchronizer: string;
  producerProgressSecondsAgo: number;
  checkedSecondsAgo: number;
  head: { number: number; timestamp: number };
}

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

/** Client for the Zenith Gateway registry API (`/v1`). */
export class GatewayClient {
  private cache = new Map<string, Cached<unknown>>();

  constructor(readonly baseUrl: string) {}

  private get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return fetchJson<T>(`${this.baseUrl}${path}`, { query });
  }

  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as Cached<T> | undefined;
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    value.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  chain(): Promise<GatewayChainInfo> {
    return this.cached("chain", 60_000, () => this.get("/v1/chain"));
  }

  registries(): Promise<Registries> {
    return this.cached("registries", 60_000, () => this.get("/v1/registries"));
  }

  health(): Promise<GatewayHealth> {
    return this.get("/v1/health");
  }

  inbox(party: string): Promise<InboxInfo> {
    return this.get(`/v1/inboxes/${encodeURIComponent(party)}`);
  }

  pendingEvm(txHash: string): Promise<PendingState> {
    return this.get(`/v1/pending/evm/${txHash}`);
  }

  pendingCanton(offerContractId: string): Promise<PendingState> {
    return this.get(`/v1/pending/canton/${encodeURIComponent(offerContractId)}`);
  }

  deriveMailbox(evmAddress: string, instrument: InstrumentRef): Promise<DerivedParty> {
    return this.get("/v1/derive/mailbox", {
      evmAddress,
      instrumentAdmin: instrument.admin,
      instrumentId: instrument.id,
    });
  }

  mailboxState(evmAddress: string, instrument: InstrumentRef): Promise<ProtocolPartyState> {
    return this.get("/v1/protocol-parties", {
      kind: "mailbox",
      evmAddress,
      instrumentAdmin: instrument.admin,
      instrumentId: instrument.id,
    });
  }

  deriveWrapper(instrument: InstrumentRef): Promise<DerivedAddress> {
    return this.cached(`wrapper:${instrument.admin}:${instrument.id}`, 10 * 60_000, () =>
      this.get("/v1/derive/wrapper", {
        instrumentAdmin: instrument.admin,
        instrumentId: instrument.id,
      }),
    );
  }

  deriveVault(token: string): Promise<DerivedAddress> {
    return this.get("/v1/derive/vault", { token });
  }
}
