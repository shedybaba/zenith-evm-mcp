import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { decodeLog, GATEWAY_ABI } from "./abi.js";
import { readErc20 } from "./account.js";
import type { ZenithContext } from "./context.js";
import { loadGatewayTokens } from "./tokens.js";

const DIRECTION: Record<string, "to-canton" | "to-evm" | "setup"> = {
  Collected: "to-canton",
  NativeCollected: "to-canton",
  Minted: "to-evm",
  Released: "to-evm",
  MetadataSet: "setup",
  WrapperRegistered: "setup",
  OriginalRegistered: "setup",
};

/** Recent Gateway crossings, decoded from the Gateway contract's own events, with per-token totals. */
export async function gatewayActivity(
  ctx: ZenithContext,
  opts: { limit?: number; includeSetup?: boolean } = {},
) {
  const limit = Math.min(opts.limit ?? 25, 200);
  const [rows, tokens] = await Promise.all([
    ctx.explorer.getLogs({
      address: ctx.network.gatewayAddress,
      fromBlock: 0,
      toBlock: "latest",
      offset: 1000,
    }),
    loadGatewayTokens(ctx),
  ]);
  const byAddress = new Map<string, { key: string; evm: { decimals: number } }>();
  for (const t of tokens) if (t.evm.address) byAddress.set(t.evm.address.toLowerCase(), t);
  const native = tokens.find((t) => t.kind === "native");

  // Tokens seen in events but missing from the table (for example a lookup that failed): read them on-chain.
  const unknown = new Set<string>();
  for (const r of rows) {
    const t = r.topics[1];
    if (t && r.topics.length >= 3) {
      const a = `0x${t.slice(-40)}`.toLowerCase();
      if (!byAddress.has(a)) unknown.add(a);
    }
  }
  await Promise.all(
    [...unknown].map(async (a) => {
      const meta = await readErc20(ctx, getAddress(a)).catch(() => null);
      if (meta) byAddress.set(a, { key: meta.symbol, evm: { decimals: meta.decimals } });
    }),
  );

  const events = rows
    .map((r) => {
      const d = decodeLog({ address: getAddress(r.address), topics: r.topics, data: r.data }, [
        { abi: GATEWAY_ABI, source: "gateway" },
      ]);
      const a = (d.args ?? {}) as Record<string, unknown>;
      const tokenAddr = (a.token ?? a.wrapper) as Address | undefined;
      const token =
        d.event === "NativeCollected"
          ? native
          : tokenAddr
            ? byAddress.get(tokenAddr.toLowerCase())
            : undefined;
      const amount = typeof a.amount === "bigint" ? a.amount : null;
      return {
        block: Number(r.blockNumber),
        time: r.timeStamp ? new Date(Number(r.timeStamp) * 1000).toISOString() : null,
        transactionHash: r.transactionHash as Hex,
        event: d.event,
        direction: d.event ? (DIRECTION[d.event] ?? "setup") : "setup",
        token: token?.key ?? tokenAddr ?? null,
        amount: amount !== null && token ? formatUnits(amount, token.evm.decimals) : amount,
        rawAmount: amount,
        counterparty: (a.inbox ?? a.to ?? null) as Address | null,
        meaning: d.meaning ?? null,
      };
    })
    .filter((e) => opts.includeSetup || e.direction !== "setup")
    .sort((x, y) => y.block - x.block);

  const totals: Record<string, { toCanton: number; toEvm: number }> = {};
  for (const e of events) {
    if (e.direction === "setup" || !e.token) continue;
    const key = String(e.token);
    totals[key] ??= { toCanton: 0, toEvm: 0 };
    if (e.direction === "to-canton") totals[key].toCanton++;
    else totals[key].toEvm++;
  }

  return {
    totalCrossings: events.filter((e) => e.direction !== "setup").length,
    perToken: totals,
    recent: events.slice(0, limit).map(({ rawAmount: _raw, ...rest }) => rest),
    note: "ZTH arriving back from Canton (wZTH → ZTH) is paid as an EIP-4895 block withdrawal, not an event, so it is not listed here.",
  };
}
