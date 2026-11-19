import { describe, expect, it } from "vitest";
import {
  AmountError,
  cantonScaledSymbol,
  cantonToErc20Base,
  cantonToZthWei,
  erc20BaseToCanton,
  formatDecimal,
  oneTokenOnCanton,
  parseDecimal,
  zthWeiToCanton,
} from "../../src/core/units.js";

// Every expectation below is an example taken from the Zenith testnet docs ("Amounts and decimals").
describe("ERC-20 amounts between Zenith EVM and Canton", () => {
  it("3.0 E (18 decimals) arrives on Canton as 300000000.0", () => {
    const r = erc20BaseToCanton(3_000_000_000_000_000_000n);
    expect(r.amount).toBe("300000000");
    expect(r.numeric).toBe("300000000.0000000000");
  });

  it("2.0 of the DevUSD wrapper (10 decimals) is 20000000000 base units and 2.0 DevUSD", () => {
    expect(erc20BaseToCanton(20_000_000_000n).amount).toBe("2");
    expect(cantonToErc20Base("2.0")).toBe(20_000_000_000n);
  });

  it("4.0 DevUSD sent to Zenith EVM shows as 40000000000 wrapper units", () => {
    expect(cantonToErc20Base("4.0")).toBe(40_000_000_000n);
  });

  it("1,234.5 of a 6-decimal token shows as 0.12345 on Canton", () => {
    expect(erc20BaseToCanton(1_234_500_000n).amount).toBe("0.12345");
  });

  it("1.0 E is 100000000.0 on Canton when sent back", () => {
    expect(cantonToErc20Base("100000000.0")).toBe(10n ** 18n);
  });

  it("refuses a Canton amount with more than 10 decimal places instead of rounding", () => {
    expect(() => cantonToErc20Base("0.00000000001")).toThrow(AmountError);
  });
});

describe("Canton symbols carry the scale", () => {
  it("names an 18-decimal original <SYMBOL>e-8 and a 6-decimal one <SYMBOL>e4", () => {
    expect(cantonScaledSymbol("DORIG", 18)).toBe("DORIGe-8");
    expect(cantonScaledSymbol("USDX", 6)).toBe("USDXe4");
    expect(cantonScaledSymbol("DUSD", 10)).toBe("DUSD");
  });

  it("1 token with d decimals is 10^(d-10) on Canton", () => {
    expect(oneTokenOnCanton(18)).toBe("100000000");
    expect(oneTokenOnCanton(6)).toBe("0.0001");
  });
});

describe("native ZTH and wZTH", () => {
  it("0.5 ZTH crosses exactly and arrives as 0.5 wZTH", () => {
    const r = zthWeiToCanton(500_000_000_000_000_000n);
    expect(r).toMatchObject({ amount: "0.5", exact: true, remainderWei: 0n });
  });

  it("flags a ZTH value that is not a multiple of 10^8 wei and offers the rounded-down value", () => {
    const r = zthWeiToCanton(123_456_789n);
    expect(r.exact).toBe(false);
    expect(r.roundedDownWei).toBe(100_000_000n);
    expect(r.remainderWei).toBe(23_456_789n);
  });

  it("0.25 wZTH crosses back as 0.25 ZTH", () => {
    expect(cantonToZthWei("0.25")).toBe(250_000_000_000_000_000n);
  });

  it("refuses wZTH that is not a whole number of gwei (not-whole-quanta)", () => {
    expect(() => cantonToZthWei("0.0000000001")).toThrow(/whole number of gwei/);
    expect(cantonToZthWei("0.000000001")).toBe(1_000_000_000n);
  });
});

describe("decimal helpers", () => {
  it("parses and formats without floating point", () => {
    expect(parseDecimal("1.000000000000000001", 18)).toBe(1_000_000_000_000_000_001n);
    expect(formatDecimal(1_000_000_000_000_000_001n, 18)).toBe("1.000000000000000001");
    expect(parseDecimal("1_000", 0)).toBe(1000n);
  });

  it("rejects non-numbers", () => {
    expect(() => parseDecimal("1e18", 18)).toThrow(AmountError);
    expect(() => parseDecimal("-1", 18)).toThrow(AmountError);
  });
});
