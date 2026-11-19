import {
  decodeEventLog,
  decodeFunctionData,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";

export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

/**
 * The Gateway contract is not verified on the explorer. These signatures were matched
 * against the topic hashes the contract emits on testnet.
 */
export const GATEWAY_ABI = parseAbi([
  "function inboxOf(string party) view returns (address)",
  "event Collected(address indexed token, address indexed inbox, uint256 amount)",
  "event NativeCollected(address indexed inbox, uint256 amount)",
  "event Minted(address indexed wrapper, address indexed to, uint256 amount)",
  "event Released(address indexed token, address indexed to, uint256 amount)",
  "event MetadataSet(address indexed wrapper, string name, string symbol)",
  "event WrapperRegistered(bytes32 indexed instrumentKey, address indexed wrapper)",
  "event OriginalRegistered(address indexed token, address indexed vault)",
]);

/** Meaning of each Gateway event, for people reading decoded logs. */
export const GATEWAY_EVENT_MEANING: Record<string, string> = {
  Collected:
    "Zenith EVM → Canton: Gateway collected an ERC-20 deposit from a party's inbox and credited it on Canton.",
  NativeCollected:
    "Zenith EVM → Canton: Gateway collected native ZTH from a party's inbox and credited it as wZTH.",
  Minted:
    "Canton → Zenith EVM: Gateway minted the ERC-20 wrapper of a Canton token to an EVM address.",
  Released:
    "Canton → Zenith EVM: Gateway released an original ERC-20 from its vault to an EVM address.",
  MetadataSet: "Gateway set the name and symbol of a wrapper token.",
  WrapperRegistered: "Gateway registered the ERC-20 wrapper of a Canton instrument.",
  OriginalRegistered: "Gateway registered an original ERC-20 and its vault.",
};

/** Selectors present in every Gateway inbox: sweepToken(address) and the NotWholeQuanta(uint256) error. */
const INBOX_MARKERS = ["631be19560", "63479e0aeb"];

export function looksLikeGatewayInbox(code: Hex | undefined | null): boolean {
  if (!code || code === "0x") return false;
  const c = code.toLowerCase();
  return INBOX_MARKERS.every((m) => c.includes(m));
}

export interface DecodedCall {
  functionName: string;
  args: unknown[];
  source: "verified" | "erc20" | "gateway";
}

export function decodeCall(
  data: Hex,
  abis: { abi: Abi; source: DecodedCall["source"] }[],
): DecodedCall | null {
  if (!data || data === "0x" || data.length < 10) return null;
  for (const { abi, source } of abis) {
    try {
      const d = decodeFunctionData({ abi, data });
      return { functionName: d.functionName, args: [...(d.args ?? [])], source };
    } catch {
      // try the next ABI
    }
  }
  return null;
}

export interface DecodedLog {
  address: Address;
  logIndex: number | null;
  event: string | null;
  args: Record<string, unknown> | null;
  meaning?: string;
  source: "verified" | "erc20" | "gateway" | "raw";
  topics?: Hex[];
  data?: Hex;
}

export function decodeLog(
  log: { address: Address; topics: Hex[]; data: Hex; logIndex?: number | null },
  abis: { abi: Abi; source: Exclude<DecodedLog["source"], "raw"> }[],
): DecodedLog {
  for (const { abi, source } of abis) {
    try {
      const d = decodeEventLog({
        abi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      });
      const raw = d.args as unknown;
      const args = Array.isArray(raw)
        ? Object.fromEntries(raw.map((v, i) => [String(i), v as unknown]))
        : ((raw ?? {}) as Record<string, unknown>);
      return {
        address: log.address,
        logIndex: log.logIndex ?? null,
        event: d.eventName ?? null,
        args,
        meaning:
          source === "gateway" && d.eventName ? GATEWAY_EVENT_MEANING[d.eventName] : undefined,
        source,
      };
    } catch {
      // try the next ABI
    }
  }
  return {
    address: log.address,
    logIndex: log.logIndex ?? null,
    event: null,
    args: null,
    source: "raw",
    topics: log.topics,
    data: log.data,
  };
}
