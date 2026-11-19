import { formatEther, formatUnits } from "viem";
import type { GatewayToken } from "./tokens.js";
import {
  AmountError,
  cantonToErc20Base,
  cantonToZthWei,
  erc20BaseToCanton,
  parseDecimal,
  zthWeiToCanton,
} from "./units.js";

export interface ConvertInput {
  direction: "to-canton" | "to-evm";
  amount: string;
  /** For to-canton: whether `amount` is in whole tokens or EVM base units. */
  unit?: "token" | "base";
}

/** Converts an amount across Gateway for one token, applying the exact crossing rules. */
export function convertAmount(token: GatewayToken, input: ConvertInput) {
  const rules =
    input.direction === "to-canton" ? token.toCanton.amountRule : token.toEvm.amountRule;
  if (input.direction === "to-canton") {
    const base =
      input.unit === "base"
        ? BigInt(input.amount.trim())
        : parseDecimal(input.amount, token.evm.decimals);
    if (token.kind === "native") {
      const z = zthWeiToCanton(base);
      return {
        direction: input.direction,
        evm: { amount: formatEther(base), symbol: token.evm.symbol, baseUnits: base },
        canton: { amount: z.amount, symbol: token.canton.symbol },
        crossesExactly: z.exact,
        note: z.exact
          ? null
          : `Not a multiple of 10^8 wei. The largest sendable value is ${z.roundedDownWei} wei (${formatEther(z.roundedDownWei)} ZTH).`,
        rule: rules,
      };
    }
    const c = erc20BaseToCanton(base);
    return {
      direction: input.direction,
      evm: {
        amount: formatUnits(base, token.evm.decimals),
        symbol: token.evm.symbol,
        baseUnits: base,
      },
      canton: { amount: c.amount, numeric: c.numeric, symbol: token.canton.symbol },
      crossesExactly: true,
      note:
        token.evm.decimals !== 10
          ? `1 ${token.evm.symbol} shows as ${token.canton.oneEvmTokenEquals} ${token.canton.symbol} on Canton: the same value, a different scale.`
          : null,
      rule: rules,
    };
  }

  // to-evm: a Canton amount.
  if (token.kind === "native") {
    let wei: bigint;
    try {
      wei = cantonToZthWei(input.amount);
    } catch (err) {
      if (err instanceof AmountError)
        return {
          direction: input.direction,
          crossesExactly: false,
          note: err.message,
          rule: rules,
        };
      throw err;
    }
    return {
      direction: input.direction,
      canton: { amount: input.amount, symbol: token.canton.symbol },
      evm: { amount: formatEther(wei), symbol: token.evm.symbol, baseUnits: wei },
      crossesExactly: true,
      note: "Arrives as a block withdrawal (EIP-4895): wallets show the new balance but no transaction.",
      rule: rules,
    };
  }
  const base = cantonToErc20Base(input.amount);
  return {
    direction: input.direction,
    canton: { amount: input.amount, symbol: token.canton.symbol },
    evm: {
      amount: formatUnits(base, token.evm.decimals),
      symbol: token.evm.symbol,
      baseUnits: base,
    },
    crossesExactly: true,
    note: null,
    rule: rules,
  };
}
