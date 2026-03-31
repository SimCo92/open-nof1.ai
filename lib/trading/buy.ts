import { binance } from "./binance";

interface BuyParams {
  symbol: string;
  amount: number;
  leverage: number;
  pricing?: number;
}

export async function buy({ symbol, amount, leverage, pricing }: BuyParams) {
  try {
    await binance.setLeverage(leverage, symbol);

    if (pricing) {
      const quantity = amount / pricing;
      const order = await binance.createLimitBuyOrder(symbol, quantity, pricing);
      return { success: true, order };
    }

    const ticker = await binance.fetchTicker(symbol);
    const currentPrice = ticker.last!;
    const quantity = amount / currentPrice;
    const order = await binance.createMarketBuyOrder(symbol, quantity);
    return { success: true, order };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Buy order failed for ${symbol}:`, message);
    return { success: false, error: message };
  }
}
