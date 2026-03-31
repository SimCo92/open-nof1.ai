import { binance } from "./binance";

interface SellParams {
  symbol: string;
  percentage: number;
}

export async function sell({ symbol, percentage }: SellParams) {
  try {
    const positions = await binance.fetchPositions([symbol]);
    const openPosition = positions.find(
      (p) => p.symbol === symbol && p.contracts && p.contracts > 0
    );

    if (!openPosition || !openPosition.contracts) {
      return { success: false, error: `No open position found for ${symbol}` };
    }

    const quantityToClose = (openPosition.contracts * percentage) / 100;

    if (quantityToClose <= 0) {
      return { success: false, error: "Calculated close quantity is zero" };
    }

    const side = openPosition.side === "long" ? "sell" : "buy";
    const order = await binance.createMarketOrder(
      symbol,
      side,
      quantityToClose,
      undefined,
      { reduceOnly: true }
    );

    return { success: true, order };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Sell order failed for ${symbol}:`, message);
    return { success: false, error: message };
  }
}
