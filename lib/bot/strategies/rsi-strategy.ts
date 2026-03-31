import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class RsiStrategy extends AbstractStrategy {
  readonly name = "RSI Overbought/Oversold";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const period = (this.params.period as number) || 14;
    const overbought = (this.params.overbought as number) || 70;
    const oversold = (this.params.oversold as number) || 30;

    const { indicators } = context.marketData;
    const rsi = indicators.rsi[period];

    if (rsi === undefined) {
      return this.hold("Insufficient RSI data");
    }

    const { histogram } = indicators.macd;
    const hasPosition = context.positions.some(
      (p) =>
        p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
    );

    const metadata = {
      rsi,
      period,
      overbought,
      oversold,
      macdHistogram: histogram,
    };

    // Oversold zone: go long if MACD histogram confirms upward momentum
    if (rsi < oversold && !hasPosition) {
      if (histogram > 0) {
        return this.long(
          0.7,
          `RSI ${rsi.toFixed(1)} below oversold (${oversold}), MACD histogram positive (${histogram.toFixed(4)})`,
          metadata,
        );
      }
      return this.hold(
        `RSI ${rsi.toFixed(1)} oversold but MACD histogram negative (${histogram.toFixed(4)}), awaiting confirmation`,
      );
    }

    // Overbought zone: close if MACD histogram confirms downward momentum
    if (rsi > overbought && hasPosition) {
      if (histogram < 0) {
        return this.close(
          0.7,
          `RSI ${rsi.toFixed(1)} above overbought (${overbought}), MACD histogram negative (${histogram.toFixed(4)})`,
          metadata,
        );
      }
      return this.hold(
        `RSI ${rsi.toFixed(1)} overbought but MACD histogram still positive (${histogram.toFixed(4)}), holding`,
      );
    }

    return this.hold(
      `RSI=${rsi.toFixed(1)} within range [${oversold}, ${overbought}]`,
    );
  }
}
