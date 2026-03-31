import type { OHLCV } from "../types";

interface CacheEntry {
  candles: OHLCV[];
  storedAt: number;
}

/**
 * In-memory OHLCV cache with TTL expiration.
 * Stores candles keyed by symbol + timeframe to avoid redundant exchange calls
 * within the same tick cycle.
 */
export class CandleCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 30_000) {
    this.ttlMs = ttlMs;
  }

  private key(symbol: string, timeframe: string): string {
    return `${symbol}:${timeframe}`;
  }

  /**
   * Returns cached candles if they exist and have not expired, otherwise null.
   */
  get(symbol: string, timeframe: string): OHLCV[] | null {
    const entry = this.cache.get(this.key(symbol, timeframe));
    if (!entry) return null;

    const age = Date.now() - entry.storedAt;
    if (age > this.ttlMs) {
      this.cache.delete(this.key(symbol, timeframe));
      return null;
    }

    return entry.candles;
  }

  /**
   * Stores candles in the cache with the current timestamp.
   */
  set(symbol: string, timeframe: string, candles: OHLCV[]): void {
    this.cache.set(this.key(symbol, timeframe), {
      candles,
      storedAt: Date.now(),
    });
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Removes expired entries. Useful for periodic cleanup in long-running bots.
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.storedAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
