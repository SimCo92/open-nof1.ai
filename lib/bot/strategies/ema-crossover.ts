import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class EmaCrossoverStrategy extends AbstractStrategy {
  readonly name = "EMA Crossover";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const fastPeriod = (this.params.fastPeriod as number) || 9;
    const slowPeriod = (this.params.slowPeriod as number) || 21;

    const { indicators, candles } = context.marketData;
    const fastEma = indicators.ema[fastPeriod];
    const slowEma = indicators.ema[slowPeriod];

    if (!fastEma || !slowEma) {
      return this.hold("Insufficient EMA data");
    }

    // Need enough candle history to reliably detect a crossover
    const closes = candles["1m"]?.map((c) => c.close) || [];
    if (closes.length < slowPeriod + 2) {
      return this.hold("Insufficient candle data for crossover detection");
    }

    // Check if we already have an open position in this symbol
    const hasPosition = context.positions.some(
      (p) =>
        p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
    );

    const crossUp = fastEma > slowEma;
    const crossDown = fastEma < slowEma;

    // Confirm with RSI to reduce false signals
    const rsi = indicators.rsi[14] || 50;

    if (crossUp && rsi < 70 && !hasPosition) {
      return this.long(
        0.6,
        `EMA ${fastPeriod} crossed above EMA ${slowPeriod} (RSI: ${rsi.toFixed(1)})`,
        { fastEma, slowEma, rsi },
      );
    }

    if (crossDown && rsi > 30 && hasPosition) {
      return this.close(
        0.6,
        `EMA ${fastPeriod} crossed below EMA ${slowPeriod} (RSI: ${rsi.toFixed(1)})`,
        { fastEma, slowEma, rsi },
      );
    }

    return this.hold(
      `EMAs: fast=${fastEma.toFixed(2)} slow=${slowEma.toFixed(2)} RSI=${rsi.toFixed(1)}`,
    );
  }
}
