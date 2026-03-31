import { binance } from "@/lib/trading/binance";
import { CandleCache } from "./candle-cache";
import { computeIndicators } from "./indicator-service";
import type { MarketDataProvider, MarketDataSnapshot, OHLCV } from "../types";
import { Logger } from "../logger";

const CANDLE_LIMIT_1M = 200;
const CANDLE_LIMIT_4H = 100;

/**
 * Fetches market data from Binance futures via CCXT and computes technical
 * indicators. Candle responses are cached to avoid duplicate requests within
 * the same tick cycle.
 */
export class BotMarketDataProvider implements MarketDataProvider {
  private cache: CandleCache;
  private log: Logger;

  constructor(cacheTtlMs?: number) {
    this.cache = new CandleCache(cacheTtlMs);
    this.log = new Logger("market-data");
  }

  async getSnapshot(symbol: string): Promise<MarketDataSnapshot> {
    const [candles1m, candles4h, price, fundingRate, openInterest] =
      await Promise.all([
        this.getCandles(symbol, "1m", CANDLE_LIMIT_1M),
        this.getCandles(symbol, "4h", CANDLE_LIMIT_4H),
        this.getPrice(symbol),
        this.fetchFundingRate(symbol),
        this.fetchOpenInterest(symbol),
      ]);

    const indicators = computeIndicators(candles1m, candles4h);

    return {
      symbol,
      timestamp: Date.now(),
      price,
      candles: {
        "1m": candles1m,
        "4h": candles4h,
      },
      indicators,
      fundingRate,
      openInterest,
    };
  }

  async getCandles(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<OHLCV[]> {
    const cached = this.cache.get(symbol, timeframe);
    if (cached) return cached;

    const raw = await binance.fetchOHLCV(symbol, timeframe, undefined, limit);

    const candles: OHLCV[] = raw.map(
      ([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      })
    );

    this.cache.set(symbol, timeframe, candles);
    return candles;
  }

  async getPrice(symbol: string): Promise<number> {
    const ticker = await binance.fetchTicker(symbol);
    return ticker.last ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchFundingRate(symbol: string): Promise<number> {
    try {
      const rates = await binance.fetchFundingRate(symbol);
      return rates.fundingRate ?? 0;
    } catch (err) {
      this.log.warn("Failed to fetch funding rate, defaulting to 0", {
        symbol,
        error: String(err),
      });
      return 0;
    }
  }

  private async fetchOpenInterest(symbol: string): Promise<number> {
    try {
      const oi = await binance.fetchOpenInterest(symbol);
      return oi.openInterestAmount ?? 0;
    } catch (err) {
      this.log.warn("Failed to fetch open interest, defaulting to 0", {
        symbol,
        error: String(err),
      });
      return 0;
    }
  }
}

export { CandleCache } from "./candle-cache";
export { computeIndicators } from "./indicator-service";
