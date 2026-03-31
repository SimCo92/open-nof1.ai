import { Symbol } from "@prisma/client";

/** CCXT trading pair, e.g. "BTC/USDT" */
export const TRADING_SYMBOL =
  process.env.TRADING_SYMBOL || "BTC/USDT";

/** Map CCXT pair to Prisma Symbol enum */
const symbolMap: Record<string, Symbol> = {
  "BTC/USDT": Symbol.BTC,
  "ETH/USDT": Symbol.ETH,
  "BNB/USDT": Symbol.BNB,
  "SOL/USDT": Symbol.SOL,
  "DOGE/USDT": Symbol.DOGE,
};

export function getPrismaSymbol(ccxtSymbol: string = TRADING_SYMBOL): Symbol {
  const symbol = symbolMap[ccxtSymbol];
  if (!symbol) {
    throw new Error(
      `Unsupported trading symbol: ${ccxtSymbol}. Supported: ${Object.keys(symbolMap).join(", ")}`
    );
  }
  return symbol;
}
