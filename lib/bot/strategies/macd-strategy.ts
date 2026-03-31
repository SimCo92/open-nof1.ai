import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class MacdStrategy extends AbstractStrategy {
  readonly name = "MACD Signal Crossover";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const { indicators } = context.marketData;
    const { value: macdValue, signal: macdSignal, histogram } = indicators.macd;
    const rsi = indicators.rsi[14] ?? 50;

    if (macdValue === undefined || macdSignal === undefined) {
      return this.hold("Insufficient MACD data");
    }

    const hasPosition = context.positions.some(
      (p) =>
        p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
    );

    const metadata = {
      macdValue,
      macdSignal,
      histogram,
      rsi,
    };

    // Bullish crossover: MACD crosses above signal line (histogram goes positive)
    // Confirm RSI is not in oversold extreme (> 30) to avoid catching falling knives
    if (histogram > 0 && !hasPosition) {
      if (rsi > 30) {
        return this.long(
          0.65,
          `MACD crossed above signal (histogram: ${histogram.toFixed(4)}), RSI: ${rsi.toFixed(1)}`,
          metadata,
        );
      }
      return this.hold(
        `MACD bullish but RSI too low (${rsi.toFixed(1)}), awaiting confirmation`,
      );
    }

    // Bearish crossover: MACD crosses below signal line (histogram goes negative)
    // Confirm RSI is not in overbought extreme (< 70) to avoid premature exit
    if (histogram < 0 && hasPosition) {
      if (rsi < 70) {
        return this.close(
          0.65,
          `MACD crossed below signal (histogram: ${histogram.toFixed(4)}), RSI: ${rsi.toFixed(1)}`,
          metadata,
        );
      }
      return this.hold(
        `MACD bearish but RSI still high (${rsi.toFixed(1)}), holding`,
      );
    }

    return this.hold(
      `MACD=${macdValue.toFixed(4)} signal=${macdSignal.toFixed(4)} histogram=${histogram.toFixed(4)} RSI=${rsi.toFixed(1)}`,
    );
  }
}
