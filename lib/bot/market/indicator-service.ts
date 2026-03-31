import { EMA, MACD, RSI, ATR, BollingerBands } from "technicalindicators";
import type { OHLCV, IndicatorValues } from "../types";

/**
 * Returns the last element of an array, or `fallback` when the array is
 * empty or undefined.
 */
function last<T>(arr: T[] | undefined, fallback: T): T {
  if (!arr || arr.length === 0) return fallback;
  return arr[arr.length - 1];
}

/**
 * Computes a full set of technical indicators from 1-minute and 4-hour candles.
 *
 * - EMA (9, 20, 50) — from 1m closes
 * - MACD (12 / 26 / 9) — from 1m closes
 * - RSI (7, 14) — from 1m closes
 * - ATR (3, 14) — from 4h candles
 * - Bollinger Bands (20, stdDev 2) — from 1m closes
 *
 * Returns 0 for any indicator that lacks sufficient data.
 */
export function computeIndicators(
  candles1m: OHLCV[],
  candles4h: OHLCV[]
): IndicatorValues {
  const closes1m = candles1m.map((c) => c.close);
  const high4h = candles4h.map((c) => c.high);
  const low4h = candles4h.map((c) => c.low);
  const close4h = candles4h.map((c) => c.close);

  // --- EMA ---
  const ema9 = EMA.calculate({ period: 9, values: closes1m });
  const ema20 = EMA.calculate({ period: 20, values: closes1m });
  const ema50 = EMA.calculate({ period: 50, values: closes1m });

  // --- MACD ---
  const macdResult = MACD.calculate({
    values: closes1m,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const lastMacd = last(macdResult, undefined);

  // --- RSI ---
  const rsi7 = RSI.calculate({ period: 7, values: closes1m });
  const rsi14 = RSI.calculate({ period: 14, values: closes1m });

  // --- ATR (from 4h candles) ---
  const atr3 = ATR.calculate({
    period: 3,
    high: high4h,
    low: low4h,
    close: close4h,
  });
  const atr14 = ATR.calculate({
    period: 14,
    high: high4h,
    low: low4h,
    close: close4h,
  });

  // --- Bollinger Bands ---
  const bbResult = BollingerBands.calculate({
    period: 20,
    stdDev: 2,
    values: closes1m,
  });
  const lastBB = last(bbResult, undefined);

  return {
    ema: {
      9: last(ema9, 0),
      20: last(ema20, 0),
      50: last(ema50, 0),
    },
    macd: {
      value: lastMacd?.MACD ?? 0,
      signal: lastMacd?.signal ?? 0,
      histogram: lastMacd?.histogram ?? 0,
    },
    rsi: {
      7: last(rsi7, 0),
      14: last(rsi14, 0),
    },
    atr: {
      3: last(atr3, 0),
      14: last(atr14, 0),
    },
    bollingerBands: lastBB
      ? {
          upper: lastBB.upper,
          middle: lastBB.middle,
          lower: lastBB.lower,
          bandwidth: (lastBB.upper - lastBB.lower) / lastBB.middle,
        }
      : undefined,
  };
}
