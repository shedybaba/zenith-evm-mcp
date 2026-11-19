import { getAddress, type Abi, type Address, type Hex } from "viem";
import { decodeLog, type DecodedLog } from "./abi.js";
import { LIMITS } from "./config.js";
import type { ZenithContext } from "./context.js";
import { abisFor, eventTopic } from "./decode.js";

export interface LogQuery {
  address?: string;
  event?: string;
  fromBlock?: number;
  toBlock?: number;
  maxLogs?: number;
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | string;
  transactionHash: Hex;
  logIndex: Hex | string;
}

const MAX_RPC_CHUNKS = 60;

/**
 * Fetches logs over any block range. The public RPC only serves 1,000 blocks per eth_getLogs call
 * and has no filters or subscriptions, so the range is walked in 1,000-block chunks (newest first)
 * until enough logs are found. Each log is decoded with the best ABI available.
 */
export async function getLogs(ctx: ZenithContext, q: LogQuery) {
  const latest = Number(await ctx.client.getBlockNumber());
  const toBlock = Math.min(q.toBlock ?? latest, latest);
  const fromBlock = Math.max(0, q.fromBlock ?? toBlock - (LIMITS.rpcMaxLogRange - 1));
  if (fromBlock > toBlock) throw new Error(`fromBlock ${fromBlock} is after toBlock ${toBlock}`);
  const maxLogs = Math.min(q.maxLogs ?? 200, 1000);
  const address = q.address ? getAddress(q.address) : undefined;
  const filter = q.event ? eventTopic(q.event) : undefined;

  const collected: RawLog[] = [];
  let scannedFrom = toBlock + 1;
  let chunks = 0;
  let source: "rpc" | "explorer" = "rpc";

  // Very wide ranges for one contract: the explorer's log index answers in a single request.
  if (address && toBlock - fromBlock + 1 > MAX_RPC_CHUNKS * LIMITS.rpcMaxLogRange) {
    const rows = await ctx.explorer
      .getLogs({
        address,
        fromBlock,
        toBlock,
        topic0: filter?.topic0,
        offset: LIMITS.explorerMaxLogs,
      })
      .catch(() => null);
    if (rows) {
      source = "explorer";
      collected.push(
        ...rows
          .map((r) => ({ ...r, blockNumber: r.blockNumber, logIndex: r.logIndex }))
          .sort(
            (a, b) =>
              Number(b.blockNumber) - Number(a.blockNumber) ||
              Number(b.logIndex) - Number(a.logIndex),
          ),
      );
      scannedFrom =
        rows.length >= LIMITS.explorerMaxLogs ? Number(collected.at(-1)!.blockNumber) : fromBlock;
    }
  }

  for (
    let end = toBlock;
    source === "rpc" && end >= fromBlock && collected.length < maxLogs && chunks < MAX_RPC_CHUNKS;
    end -= LIMITS.rpcMaxLogRange
  ) {
    const start = Math.max(fromBlock, end - LIMITS.rpcMaxLogRange + 1);
    const logs = await ctx.rpc.request<RawLog[]>("eth_getLogs", [
      {
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
        ...(address ? { address } : {}),
        ...(filter ? { topics: [filter.topic0] } : {}),
      },
    ]);
    collected.push(...logs.reverse());
    scannedFrom = start;
    chunks++;
  }

  const truncated = collected.length > maxLogs || scannedFrom > fromBlock;
  const selected = collected.slice(0, maxLogs);
  const abiCache = new Map<string, Awaited<ReturnType<typeof abisFor>>>();
  const decoded: (DecodedLog & { blockNumber: number; transactionHash: Hex })[] = [];
  for (const log of selected) {
    const key = log.address.toLowerCase();
    if (!abiCache.has(key))
      abiCache.set(key, await abisFor(ctx, log.address, filter?.abi as Abi | undefined));
    decoded.push({
      ...decodeLog(
        {
          address: getAddress(log.address),
          topics: log.topics,
          data: log.data,
          logIndex: Number(log.logIndex),
        },
        abiCache.get(key)!,
      ),
      blockNumber: Number(log.blockNumber),
      transactionHash: log.transactionHash,
    });
  }

  return {
    query: { address: address ?? null, event: q.event ?? null, fromBlock, toBlock },
    scanned: { fromBlock: scannedFrom, toBlock, source, rpcCalls: chunks },
    count: decoded.length,
    truncated,
    nextToBlock: truncated
      ? Math.max(fromBlock, (decoded.at(-1)?.blockNumber ?? scannedFrom) - 1)
      : null,
    logs: decoded,
  };
}
