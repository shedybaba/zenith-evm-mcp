import {
  decodeErrorResult,
  parseAbi,
  parseAbiItem,
  slice,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { decodeCall, decodeLog, ERC20_ABI, GATEWAY_ABI, type DecodedLog } from "./abi.js";
import type { ZenithContext } from "./context.js";

type Source = "verified" | "erc20" | "gateway";

/** Errors a Zenith user is likely to meet, including the inbox's own quantum check. */
const KNOWN_ERRORS = parseAbi([
  "error Error(string)",
  "error Panic(uint256)",
  "error NotWholeQuanta(uint256 value)",
]);

/** Parses a human signature ("transfer(address,uint256)" or "function transfer(...)") into an ABI. */
export function abiFromSignature(signature: string, kind: "function" | "event"): Abi {
  const s = signature.trim();
  const full = /^(function|event|error)\s/.test(s) ? s : `${kind} ${s}`;
  return [parseAbiItem(full)] as Abi;
}

/** ABIs to try for an address: its verified ABI, then the Gateway ABI, then ERC-20. */
export async function abisFor(
  ctx: ZenithContext,
  address: Address | null | undefined,
  extra?: Abi,
) {
  const list: { abi: Abi; source: Source }[] = [];
  if (extra) list.push({ abi: extra, source: "verified" });
  if (address) {
    const verified = await ctx.explorer.getAbi(address);
    if (verified) list.push({ abi: verified, source: "verified" });
    if (address.toLowerCase() === ctx.network.gatewayAddress.toLowerCase())
      list.push({ abi: GATEWAY_ABI, source: "gateway" });
  }
  list.push({ abi: ERC20_ABI, source: "erc20" });
  list.push({ abi: GATEWAY_ABI, source: "gateway" });
  return list;
}

export async function decodeCalldata(
  ctx: ZenithContext,
  data: Hex,
  opts: { address?: Address; signature?: string; abi?: Abi } = {},
) {
  const extra =
    opts.abi ?? (opts.signature ? abiFromSignature(opts.signature, "function") : undefined);
  const decoded = decodeCall(data, await abisFor(ctx, opts.address, extra));
  return decoded
    ? { selector: slice(data, 0, 4), ...decoded }
    : {
        selector: data.length >= 10 ? slice(data, 0, 4) : null,
        functionName: null,
        args: null,
        note: "No known or verified ABI matches this selector. Pass a signature to decode it.",
      };
}

export async function decodeEvent(
  ctx: ZenithContext,
  log: { address?: Address; topics: Hex[]; data: Hex },
  opts: { signature?: string; abi?: Abi } = {},
): Promise<DecodedLog> {
  const extra =
    opts.abi ?? (opts.signature ? abiFromSignature(opts.signature, "event") : undefined);
  const address = log.address ?? ("0x0000000000000000000000000000000000000000" as Address);
  return decodeLog({ ...log, address }, await abisFor(ctx, log.address, extra));
}

export async function decodeRevert(
  ctx: ZenithContext,
  data: Hex,
  opts: { address?: Address; abi?: Abi } = {},
) {
  const abis: Abi[] = [];
  if (opts.abi) abis.push(opts.abi);
  if (opts.address) {
    const verified = await ctx.explorer.getAbi(opts.address);
    if (verified) abis.push(verified);
  }
  abis.push(KNOWN_ERRORS);
  for (const abi of abis) {
    try {
      const r = decodeErrorResult({ abi, data });
      const explanation =
        r.errorName === "NotWholeQuanta"
          ? "A Gateway inbox refused a ZTH value that is not a multiple of 10^8 wei."
          : r.errorName === "Panic"
            ? "Solidity panic (for example overflow, division by zero or an assert)."
            : undefined;
      return { errorName: r.errorName, args: r.args ?? [], explanation };
    } catch {
      // try the next ABI
    }
  }
  return {
    errorName: null,
    args: null,
    selector: data.length >= 10 ? slice(data, 0, 4) : null,
    note: "Unknown error selector.",
  };
}

export function eventTopic(signature: string): { topic0: Hex; abi: Abi } {
  const abi = abiFromSignature(signature, "event");
  return { topic0: toEventSelector(abi[0] as AbiEvent), abi };
}
