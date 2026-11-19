import type { Abi, Address, Hex } from "viem";
import { fetchJson } from "./http.js";
import { LIMITS } from "./config.js";
import { RateLimiter } from "./limiter.js";

interface EtherscanEnvelope<T> {
  status: string;
  message: string;
  result: T;
}

export interface SourceInfo {
  verified: boolean;
  contractName: string;
  compilerVersion: string;
  optimizationUsed: boolean;
  runs: number;
  constructorArguments: string;
  proxy: boolean;
  implementation: string | null;
  sourceCode: string;
}

export interface ExternalCall {
  id: number;
  correlationId: string;
  status: string;
  cantonUpdateId: string | null;
  cantonCommandId: string | null;
  cantonTemplate: string | null;
  cantonChoice: string | null;
  evmTxHash: string | null;
  evmBlockNumber: string | null;
  evmStatus: number | null;
  participantsConfirmed: number | null;
  participantsTotal: number | null;
  cantonInitiatedAt: string | null;
  evmExecutedAt: string | null;
  consensusReachedAt: string | null;
  cantonFinalizedAt: string | null;
}

export interface ExplorerHealth {
  status: string;
  network?: { id: string; label: string };
  timestamp: string;
  services: Record<string, { status: string; latency?: number; blockNumber?: string }>;
}

export interface FaucetStatus {
  enabled: boolean;
  zthAmount: string | null;
  zthFixed: boolean;
  cooldownMinutes: number;
  cooldownLabel: string;
  minIntervalSeconds: number;
  githubCreatedBefore: string | null;
  githubMaxPerWindow: number | null;
}

export interface ExplorerLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: string;
  transactionHash: Hex;
  logIndex: string;
  timeStamp?: string;
}

/** Client for the Zenith explorer: its REST API and its Etherscan-compatible module API. */
export class ExplorerClient {
  private readonly limiter = new RateLimiter({
    maxPerWindow: LIMITS.explorerRequestsPerSecond,
    windowMs: 1000,
    maxConcurrent: 4,
  });
  private readonly abiCache = new Map<string, Abi | null>();

  constructor(
    readonly baseUrl: string,
    readonly apiUrl: string,
  ) {}

  txUrl(hash: string): string {
    return `${this.baseUrl}/tx/${hash}`;
  }
  addressUrl(address: string): string {
    return `${this.baseUrl}/address/${address}`;
  }

  private get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.limiter.run(() => fetchJson<T>(`${this.apiUrl}${path}`, { query }));
  }

  /** Calls the Etherscan-style module API. Returns null for "no records" answers. */
  async module<T>(
    module: string,
    action: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T | null> {
    const env = await this.get<EtherscanEnvelope<T>>("", { module, action, ...params });
    if (env.status === "1") return env.result;
    const text = typeof env.result === "string" ? env.result : env.message;
    if (/no (records|transactions|logs)|not found|not verified/i.test(`${env.message} ${text}`))
      return null;
    throw new Error(`Explorer ${module}.${action}: ${text}`);
  }

  async getAbi(address: string): Promise<Abi | null> {
    const key = address.toLowerCase();
    if (this.abiCache.has(key)) return this.abiCache.get(key) ?? null;
    let abi: Abi | null = null;
    try {
      const raw = await this.module<string>("contract", "getabi", { address });
      abi = raw ? (JSON.parse(raw) as Abi) : null;
    } catch {
      abi = null;
    }
    this.abiCache.set(key, abi);
    return abi;
  }

  async getSourceInfo(address: string): Promise<SourceInfo> {
    const rows = await this.module<Record<string, string>[]>("contract", "getsourcecode", {
      address,
    });
    const row = rows?.[0] ?? {};
    const sourceCode = row.SourceCode ?? "";
    return {
      verified: Boolean(sourceCode || row.ABI?.startsWith("[")),
      contractName: row.ContractName ?? "",
      compilerVersion: row.CompilerVersion ?? "",
      optimizationUsed: row.OptimizationUsed === "1",
      runs: Number(row.Runs ?? 0),
      constructorArguments: row.ConstructorArguments ?? "",
      proxy: row.Proxy === "1",
      implementation: row.Implementation || null,
      sourceCode,
    };
  }

  async getContractCreation(
    addresses: string[],
  ): Promise<{ contractAddress: string; contractCreator: string; txHash: string }[]> {
    return (
      (await this.module("contract", "getcontractcreation", {
        contractaddresses: addresses.slice(0, 10).join(","),
      })) ?? []
    );
  }

  async txList(
    address: string,
    opts: { page?: number; offset?: number; sort?: "asc" | "desc" } = {},
  ): Promise<Record<string, string>[]> {
    return (
      (await this.module("account", "txlist", {
        address,
        page: opts.page ?? 1,
        offset: opts.offset ?? 25,
        sort: opts.sort ?? "desc",
      })) ?? []
    );
  }

  async tokenTx(
    address: string,
    opts: { contractaddress?: string; page?: number; offset?: number } = {},
  ): Promise<Record<string, string>[]> {
    return (
      (await this.module("account", "tokentx", {
        address,
        contractaddress: opts.contractaddress,
        page: opts.page ?? 1,
        offset: opts.offset ?? 100,
        sort: "desc",
      })) ?? []
    );
  }

  async getLogs(opts: {
    address?: string;
    fromBlock: number | "latest";
    toBlock: number | "latest";
    topic0?: string;
    topic1?: string;
    topic2?: string;
    page?: number;
    offset?: number;
  }): Promise<ExplorerLog[]> {
    return (
      (await this.module<ExplorerLog[]>("logs", "getLogs", {
        ...opts,
        page: opts.page ?? 1,
        offset: opts.offset ?? 1000,
      })) ?? []
    );
  }

  async verifySource(form: Record<string, string>): Promise<string> {
    const env = await this.limiter.run(() =>
      fetchJson<EtherscanEnvelope<string>>(this.apiUrl, {
        method: "POST",
        form: { module: "contract", action: "verifysourcecode", ...form },
      }),
    );
    if (env.status !== "1")
      throw new Error(`Verification was not accepted: ${env.result || env.message}`);
    return env.result;
  }

  async checkVerifyStatus(guid: string): Promise<{ done: boolean; ok: boolean; message: string }> {
    const env = await this.get<EtherscanEnvelope<string>>("", {
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    const text = String(env.result ?? env.message);
    if (/pending|queue|in progress/i.test(text)) return { done: false, ok: false, message: text };
    return { done: true, ok: env.status === "1" || /pass|verified/i.test(text), message: text };
  }

  health(): Promise<ExplorerHealth> {
    return this.get<ExplorerHealth>("/health");
  }

  faucet(): Promise<FaucetStatus> {
    return this.get<FaucetStatus>("/faucet");
  }

  externalCalls(page: number, pageSize = 100): Promise<{ data: ExternalCall[]; total: number }> {
    return this.get("/external-calls", { page, pageSize });
  }

  /**
   * Finds the Canton update that settled an EVM transaction.
   * The explorer lists these records newest first, so a binary search on block number finds the right page.
   */
  async findCantonLink(txHash: string, blockNumber: bigint): Promise<ExternalCall | null> {
    const pageSize = 100;
    const target = txHash.toLowerCase();
    const first = await this.externalCalls(1, pageSize);
    const match = (rows: ExternalCall[]) =>
      rows.find((r) => (r.evmTxHash ?? r.correlationId)?.toLowerCase() === target) ?? null;
    const hit = match(first.data);
    if (hit) return hit;
    const pages = Math.max(1, Math.ceil(first.total / pageSize));
    const blockOf = (rows: ExternalCall[], pick: "first" | "last") => {
      const row = pick === "first" ? rows[0] : rows[rows.length - 1];
      return row?.evmBlockNumber ? BigInt(row.evmBlockNumber) : null;
    };
    let lo = 1;
    let hi = pages;
    for (let i = 0; i < 24 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const { data } = await this.externalCalls(mid, pageSize);
      const found = match(data);
      if (found) return found;
      const newest = blockOf(data, "first");
      const oldest = blockOf(data, "last");
      if (newest === null || oldest === null) return null;
      if (blockNumber > newest) hi = mid - 1;
      else if (blockNumber < oldest) lo = mid + 1;
      else {
        for (const p of [mid - 1, mid + 1]) {
          if (p < 1 || p > pages) continue;
          const near = match((await this.externalCalls(p, pageSize)).data);
          if (near) return near;
        }
        return null;
      }
    }
    return null;
  }
}
