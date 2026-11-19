import { CANTON_DECIMALS, WZTH_QUANTUM_WEI, ZTH_QUANTUM_WEI } from "./config.js";

export class AmountError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_NUMBER"
      | "TOO_MANY_DECIMALS"
      | "NOT_POSITIVE"
      | "NOT_WHOLE_QUANTA"
      | "NOT_WHOLE_GWEI",
  ) {
    super(message);
    this.name = "AmountError";
  }
}

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Parses a decimal string into an integer of `decimals` places. Never rounds: extra precision is an error. */
export function parseDecimal(value: string, decimals: number): bigint {
  const v = value.trim().replace(/_/g, "");
  if (!DECIMAL_RE.test(v))
    throw new AmountError(`"${value}" is not a plain decimal number`, "INVALID_NUMBER");
  const [whole = "0", frac = ""] = v.split(".");
  const significant = frac.replace(/0+$/, "");
  if (significant.length > decimals) {
    throw new AmountError(
      `"${value}" has more than ${decimals} decimal places`,
      "TOO_MANY_DECIMALS",
    );
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(significant.padEnd(decimals, "0") || "0");
}

/** Formats an integer of `decimals` places as a decimal string, trimming trailing zeros. */
export function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Canton's Numeric(10) rendering, as shown in holdings (for example "300000000.0000000000"). */
export function formatCantonNumeric(value: bigint): string {
  const base = 10n ** BigInt(CANTON_DECIMALS);
  return `${value / base}.${(value % base).toString().padStart(CANTON_DECIMALS, "0")}`;
}

/** ERC-20 base units to the Canton amount: one EVM base unit is 1e-10 on Canton, for every token. */
export function erc20BaseToCanton(baseUnits: bigint): { amount: string; numeric: string } {
  return {
    amount: formatDecimal(baseUnits, CANTON_DECIMALS),
    numeric: formatCantonNumeric(baseUnits),
  };
}

/** A Canton amount of a Gateway ERC-20 to EVM base units. */
export function cantonToErc20Base(amount: string): bigint {
  return parseDecimal(amount, CANTON_DECIMALS);
}

export interface ZthToCanton {
  /** wZTH amount that arrives on Canton. */
  amount: string;
  /** True when the wei value is a whole number of 10^8-wei quanta. */
  exact: boolean;
  /** Largest sendable value at or below the input. */
  roundedDownWei: bigint;
  /** Wei that would have to be dropped to make the value sendable. */
  remainderWei: bigint;
}

/** Native ZTH (wei) to wZTH on Canton. Only multiples of 10^8 wei can cross. */
export function zthWeiToCanton(wei: bigint): ZthToCanton {
  const remainderWei = wei % ZTH_QUANTUM_WEI;
  const roundedDownWei = wei - remainderWei;
  return {
    amount: formatDecimal(roundedDownWei, 18),
    exact: remainderWei === 0n,
    roundedDownWei,
    remainderWei,
  };
}

/** wZTH (Canton amount) to native ZTH wei. Only whole gwei (at most 9 decimals) can cross back. */
export function cantonToZthWei(amount: string): bigint {
  const wei = parseDecimal(amount, 18);
  if (wei % WZTH_QUANTUM_WEI !== 0n) {
    throw new AmountError(
      `${amount} wZTH is not a whole number of gwei (use at most 9 decimal places); the registry refuses it with "not-whole-quanta"`,
      "NOT_WHOLE_GWEI",
    );
  }
  return wei;
}

/** Canton symbol for a Gateway-wrapped ERC-20: the scale is part of the symbol (DORIG with 18 decimals is DORIGe-8). */
export function cantonScaledSymbol(symbol: string, erc20Decimals: number): string {
  const exponent = CANTON_DECIMALS - erc20Decimals;
  return exponent === 0 ? symbol : `${symbol}e${exponent}`;
}

/** How much one whole ERC-20 token shows as on Canton: 10^(decimals - 10). */
export function oneTokenOnCanton(erc20Decimals: number): string {
  return formatDecimal(10n ** BigInt(erc20Decimals), CANTON_DECIMALS);
}
