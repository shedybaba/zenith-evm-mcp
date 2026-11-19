import { createPublicClient, custom, type PublicClient } from "viem";
import { LIMITS, type ZenithNetwork } from "./config.js";
import { RateLimiter } from "./limiter.js";
import { VERSION } from "../version.js";

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
    readonly method?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcCall {
  method: string;
  params?: unknown[];
}

export type BatchResult<T = unknown> = { ok: true; result: T } | { ok: false; error: RpcError };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * JSON-RPC client that stays inside the public Zenith RPC limits:
 * 600 calls/min and 4 in flight per IP, 30 raw sends/min, batches of at most 20.
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly limiter: RateLimiter;
  private readonly sendLimiter: RateLimiter;

  constructor(readonly url: string) {
    this.limiter = new RateLimiter({
      maxPerWindow: LIMITS.rpcCallsPerMinute,
      windowMs: 60_000,
      maxConcurrent: LIMITS.rpcMaxInFlight,
    });
    this.sendLimiter = new RateLimiter({
      maxPerWindow: LIMITS.rpcSendRawPerMinute,
      windowMs: 60_000,
      maxConcurrent: 1,
    });
  }

  async request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const run = () =>
      this.limiter.run(() =>
        this.post<JsonRpcResponse<T>>({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      );
    const res = method === "eth_sendRawTransaction" ? await this.sendLimiter.run(run) : await run();
    if (res.error) throw new RpcError(res.error.message, res.error.code, res.error.data, method);
    return res.result as T;
  }

  /** Sends calls in batches of at most 20; each call succeeds or fails on its own. */
  async batch<T = unknown>(calls: RpcCall[]): Promise<BatchResult<T>[]> {
    const out: BatchResult<T>[] = [];
    for (let i = 0; i < calls.length; i += LIMITS.rpcMaxBatch) {
      const chunk = calls.slice(i, i + LIMITS.rpcMaxBatch);
      const payload = chunk.map((c) => ({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: c.method,
        params: c.params ?? [],
      }));
      const res = await this.limiter.run(() => this.post<JsonRpcResponse<T>[]>(payload));
      const byId = new Map(res.map((r) => [r.id, r]));
      for (const req of payload) {
        const r = byId.get(req.id);
        if (!r)
          out.push({
            ok: false,
            error: new RpcError("missing batch response", -32603, undefined, req.method),
          });
        else if (r.error)
          out.push({
            ok: false,
            error: new RpcError(r.error.message, r.error.code, r.error.data, req.method),
          });
        else out.push({ ok: true, result: r.result as T });
      }
    }
    return out;
  }

  private async post<R>(payload: unknown, attempt = 0): Promise<R> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": `zenith-evm-mcp/${VERSION}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // Network-level failure (DNS, connect timeout, reset). Re-sending the same request is safe:
      // reads are idempotent and a re-sent signed transaction has the same hash.
      if (attempt < 2) {
        await sleep(1000 * (attempt + 1));
        return this.post<R>(payload, attempt + 1);
      }
      throw new RpcError(`Could not reach the Zenith RPC: ${(err as Error).message}`, -32099);
    }
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 15) * 1000 : 2000,
      );
      return this.post<R>(payload, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RpcError(`RPC HTTP ${res.status}: ${text.slice(0, 200)}`, -32000);
    }
    return (await res.json()) as R;
  }
}

/** A viem public client whose every request goes through the rate-limited JSON-RPC client. */
export function createZenithPublicClient(network: ZenithNetwork, rpc: JsonRpcClient): PublicClient {
  return createPublicClient({
    chain: zenithChain(network),
    transport: custom({
      request: ({ method, params }) => rpc.request(method, (params as unknown[] | undefined) ?? []),
    }),
  });
}

export function zenithChain(network: ZenithNetwork) {
  return {
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: "Zenith token",
      symbol: network.nativeSymbol,
      decimals: network.nativeDecimals,
    },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: {
      default: {
        name: "Zenith Explorer",
        url: network.explorerUrl,
        apiUrl: network.explorerApiUrl,
      },
    },
    testnet: true,
  } as const;
}
