import { getAddress, isAddress, type Address } from "viem";
import { ERC20_ABI } from "./abi.js";
import { CANTON_DECIMALS, WZTH_QUANTUM_WEI, ZTH_QUANTUM_WEI } from "./config.js";
import type { ZenithContext } from "./context.js";
import type { Registry, RegistryInstrument } from "./gateway.js";
import { cantonScaledSymbol, oneTokenOnCanton } from "./units.js";

export type GatewayTokenKind = "native" | "erc20-original" | "canton-original" | "external-cip56";

export interface GatewayToken {
  /** Short handle the tools accept, for example "ZTH", "DORIG", "DevUSD". */
  key: string;
  kind: GatewayTokenKind;
  name: string;
  evm: {
    /** null for native ZTH. */
    address: Address | null;
    symbol: string;
    decimals: number;
    /** True when the EVM side is an ERC-20 wrapper that Gateway deploys. */
    isGatewayWrapper: boolean;
    deployed: boolean;
  };
  canton: {
    admin: string;
    instrumentId: string;
    symbol: string;
    decimals: number;
    registryUrl: string;
    oneEvmTokenEquals: string;
  };
  toCanton: { route: string; recipientNeeds: string | null; amountRule: string };
  toEvm: { route: string; amountRule: string };
}

const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function readErc20Meta(
  ctx: ZenithContext,
  address: Address,
): Promise<{ symbol: string | null; decimals: number | null; deployed: boolean }> {
  const code = await ctx.client.getCode({ address }).catch(() => undefined);
  if (!code || code === "0x") return { symbol: null, decimals: null, deployed: false };
  const [symbol, decimals] = await Promise.all([
    ctx.client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }).catch(() => null),
    ctx.client
      .readContract({ address, abi: ERC20_ABI, functionName: "decimals" })
      .catch(() => null),
  ]);
  return { symbol, decimals: decimals === null ? null : Number(decimals), deployed: true };
}

function registryUrl(ctx: ZenithContext, reg: Registry): string {
  return reg.baseUrl.startsWith("http")
    ? reg.baseUrl
    : `${ctx.network.gatewayApiUrl}${reg.baseUrl}`;
}

async function cantonOriginal(
  ctx: ZenithContext,
  reg: Registry,
  inst: RegistryInstrument,
  kind: GatewayTokenKind,
): Promise<GatewayToken> {
  const wrapper = await ctx.gateway
    .deriveWrapper({ admin: reg.admin, id: inst.id })
    .catch(() => null);
  const address = wrapper?.address ? getAddress(wrapper.address) : null;
  const meta = address
    ? await readErc20Meta(ctx, address)
    : { symbol: null, decimals: null, deployed: false };
  const acceptance =
    kind === "canton-original"
      ? `a standing acceptance (transfer preapproval) at the ${inst.id} registry`
      : `a standing acceptance with the ${inst.id} registry, and a participant that stays online while deliveries settle`;
  return {
    key: inst.id,
    kind,
    name: inst.name,
    evm: {
      address,
      symbol: meta.symbol ?? inst.symbol,
      decimals: meta.decimals ?? CANTON_DECIMALS,
      isGatewayWrapper: true,
      deployed: meta.deployed,
    },
    canton: {
      admin: reg.admin,
      instrumentId: inst.id,
      symbol: inst.id,
      decimals: inst.decimals,
      registryUrl: registryUrl(ctx, reg),
      oneEvmTokenEquals: "1.0",
    },
    toCanton: {
      route: "ERC-20 transfer of the wrapper to the recipient party's inbox address",
      recipientNeeds: acceptance,
      amountRule: "any positive amount of wrapper base units (10 decimals)",
    },
    toEvm: {
      route:
        "CIP-56 transfer on Canton to the mailbox party of the destination EVM address for this instrument",
      amountRule: "at most 10 decimal places",
    },
  };
}

/** Every token Gateway can move today, with both sides described. Built from /v1/chain, /v1/registries and on-chain metadata. */
export async function loadGatewayTokens(ctx: ZenithContext): Promise<GatewayToken[]> {
  const [chain, regs] = await Promise.all([ctx.gateway.chain(), ctx.gateway.registries()]);
  const tokens: Promise<GatewayToken>[] = [];

  for (const reg of regs.registries) {
    if (reg.kind === "native-zth") {
      const inst = reg.instruments[0];
      tokens.push(
        Promise.resolve({
          key: "ZTH",
          kind: "native",
          name: "Zenith token (native)",
          evm: {
            address: null,
            symbol: ctx.network.nativeSymbol,
            decimals: 18,
            isGatewayWrapper: false,
            deployed: true,
          },
          canton: {
            admin: reg.admin,
            instrumentId: inst?.id ?? chain.native.instrument.id,
            symbol: inst?.symbol ?? "wZTH",
            decimals: inst?.decimals ?? CANTON_DECIMALS,
            registryUrl: registryUrl(ctx, reg),
            oneEvmTokenEquals: "1.0",
          },
          toCanton: {
            route: "plain value transfer to the recipient party's inbox address",
            recipientNeeds: null,
            amountRule: `a multiple of ${ZTH_QUANTUM_WEI} wei (0.0000000001 ZTH)`,
          },
          toEvm: {
            route:
              "CIP-56 transfer of wZTH to the mailbox party of the destination EVM address; arrives as a block withdrawal (no transaction in wallets)",
            amountRule: `a whole number of gwei (${WZTH_QUANTUM_WEI} wei, at most 9 decimal places)`,
          },
        }),
      );
    } else if (reg.kind === "wrapped-erc20") {
      const tokenAddr = reg.token ?? reg.evm?.token;
      const inst = reg.instruments[0];
      if (!tokenAddr || !inst) continue;
      tokens.push(
        (async () => {
          const address = getAddress(tokenAddr);
          const meta = await readErc20Meta(ctx, address);
          const decimals = reg.evm?.erc20Decimals ?? meta.decimals ?? 18;
          const evmSymbol = meta.symbol ?? inst.symbol.replace(/e-?\d+$/, "");
          return {
            key: evmSymbol,
            kind: "erc20-original" as const,
            name: inst.name,
            evm: {
              address,
              symbol: evmSymbol,
              decimals,
              isGatewayWrapper: false,
              deployed: meta.deployed,
            },
            canton: {
              admin: reg.admin,
              instrumentId: inst.id,
              symbol: inst.symbol || cantonScaledSymbol(evmSymbol, decimals),
              decimals: inst.decimals,
              registryUrl: registryUrl(ctx, reg),
              oneEvmTokenEquals: oneTokenOnCanton(decimals),
            },
            toCanton: {
              route: "ERC-20 transfer to the recipient party's inbox address",
              recipientNeeds: null,
              amountRule: "any positive amount of base units",
            },
            toEvm: {
              route:
                "CIP-56 transfer on Canton to the mailbox party of the destination EVM address",
              amountRule: "at most 10 decimal places",
            },
          };
        })(),
      );
    } else {
      for (const inst of reg.instruments)
        tokens.push(cantonOriginal(ctx, reg, inst, "canton-original"));
    }
  }
  for (const reg of regs.externalRegistries ?? []) {
    for (const inst of reg.instruments)
      tokens.push(cantonOriginal(ctx, reg, inst, "external-cip56"));
  }
  return Promise.all(tokens);
}

/** Finds a Gateway token by handle, EVM or Canton symbol, EVM address or Canton instrument ID (case-insensitive). */
export function matchGatewayToken(tokens: GatewayToken[], query: string): GatewayToken | null {
  const q = query.trim().toLowerCase();
  if (["zth", "native", "eth", "wzth"].includes(q))
    return tokens.find((t) => t.kind === "native") ?? null;
  if (isAddress(q, { strict: false }))
    return tokens.find((t) => sameAddress(t.evm.address, q)) ?? null;
  return (
    tokens.find(
      (t) =>
        t.key.toLowerCase() === q ||
        t.evm.symbol.toLowerCase() === q ||
        t.canton.symbol.toLowerCase() === q ||
        t.canton.instrumentId.toLowerCase() === q,
    ) ?? null
  );
}
