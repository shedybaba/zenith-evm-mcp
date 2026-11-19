import {
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  size,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI, looksLikeGatewayInbox } from "./abi.js";
import type { ZenithContext } from "./context.js";

export const EIP1967 = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  proxiable: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
} as const;

const ZERO_WORD = /^0x0*$/;

function slotToAddress(word: Hex | undefined): Address | null {
  if (!word || ZERO_WORD.test(word)) return null;
  return getAddress(`0x${word.slice(-40)}`);
}

/** Reads the standard proxy storage slots (EIP-1967 and EIP-1822). */
export async function readProxySlots(ctx: ZenithContext, address: Address) {
  const read = (slot: Hex) => ctx.client.getStorageAt({ address, slot }).catch(() => undefined);
  const [impl, admin, beacon, proxiable] = await Promise.all([
    read(EIP1967.implementation),
    read(EIP1967.admin),
    read(EIP1967.beacon),
    read(EIP1967.proxiable),
  ]);
  const result = {
    implementation: slotToAddress(impl) ?? slotToAddress(proxiable),
    admin: slotToAddress(admin),
    beacon: slotToAddress(beacon),
  };
  return { ...result, isProxy: Boolean(result.implementation || result.beacon) };
}

export async function readErc20(ctx: ZenithContext, address: Address) {
  const call = <T>(functionName: "name" | "symbol" | "decimals" | "totalSupply") =>
    ctx.client
      .readContract({ address, abi: ERC20_ABI, functionName })
      .then((v) => v as T)
      .catch(() => null);
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    call<string>("name"),
    call<string>("symbol"),
    call<number>("decimals"),
    call<bigint>("totalSupply"),
  ]);
  if (symbol === null || decimals === null || totalSupply === null) return null;
  return {
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: formatUnits(totalSupply, Number(decimals)),
  };
}

export async function accountInfo(
  ctx: ZenithContext,
  input: string,
  opts: { holdings?: boolean; recent?: number } = {},
) {
  if (!isAddress(input, { strict: false })) throw new Error(`"${input}" is not an EVM address`);
  const address = getAddress(input);
  const [balance, nonce, code] = await Promise.all([
    ctx.client.getBalance({ address }),
    ctx.client.getTransactionCount({ address }),
    ctx.client.getCode({ address }),
  ]);
  const isContract = Boolean(code && code !== "0x");
  const isGateway = address.toLowerCase() === ctx.network.gatewayAddress.toLowerCase();

  let contract: Record<string, unknown> | null = null;
  if (isContract) {
    const [source, proxy, token] = await Promise.all([
      ctx.explorer.getSourceInfo(address).catch(() => null),
      readProxySlots(ctx, address),
      readErc20(ctx, address),
    ]);
    contract = {
      codeSizeBytes: size(code!),
      kind: isGateway
        ? "zenith-gateway"
        : looksLikeGatewayInbox(code)
          ? "gateway-inbox"
          : token
            ? "erc20"
            : "contract",
      verified: source?.verified ?? false,
      name: source?.contractName || null,
      compilerVersion: source?.compilerVersion || null,
      proxy: proxy.isProxy ? proxy : null,
      token,
    };
    if (looksLikeGatewayInbox(code)) {
      contract.note =
        "This is a Gateway inbox: an EVM address that belongs to one Canton party. Tokens sent here are delivered to that party on Canton. Only send registered tokens, directly from a wallet.";
    }
  }

  let holdings: unknown[] | undefined;
  if (opts.holdings !== false) {
    const transfers = await ctx.explorer.tokenTx(address, { offset: 200 }).catch(() => []);
    const tokens = [
      ...new Set(transfers.map((t) => t.contractAddress?.toLowerCase()).filter(Boolean)),
    ].slice(0, 15) as Address[];
    holdings = (
      await Promise.all(
        tokens.map(async (token) => {
          const [bal, meta] = await Promise.all([
            ctx.client
              .readContract({
                address: token,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [address],
              })
              .catch(() => null),
            readErc20(ctx, token),
          ]);
          if (bal === null || !meta || bal === 0n) return null;
          return {
            token: getAddress(token),
            symbol: meta.symbol,
            balance: formatUnits(bal, meta.decimals),
            raw: bal,
          };
        }),
      )
    ).filter(Boolean);
  }

  const recent = opts.recent ?? 5;
  const txs =
    recent > 0 ? await ctx.explorer.txList(address, { offset: recent }).catch(() => []) : [];

  return {
    address,
    type: isContract ? "contract" : "wallet",
    balance: { wei: balance, zth: formatEther(balance) },
    nonce,
    contract,
    tokenHoldings: holdings,
    recentTransactions: txs.map((t) => ({
      hash: t.hash,
      block: t.blockNumber,
      time: t.timeStamp ? new Date(Number(t.timeStamp) * 1000).toISOString() : undefined,
      from: t.from,
      to: t.to || t.contractAddress || null,
      method: t.functionName || t.methodId || null,
      status: t.txreceipt_status === "0" || t.isError === "1" ? "failed" : "success",
    })),
    explorer: ctx.explorer.addressUrl(address),
  };
}
