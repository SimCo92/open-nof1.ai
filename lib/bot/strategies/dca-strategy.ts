import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class DcaStrategy extends AbstractStrategy {
  readonly name = "Dollar-Cost Averaging";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const dropThresholdPct = (this.params.dropThresholdPct as number) || 3;
    const maxEntries = (this.params.maxEntries as number) || 5;
    const baseAmount = (this.params.baseAmount as number) || 100;

    const { price, candles } = context.marketData;
    const minuteCandles = candles["1m"] ?? [];

    if (minuteCandles.length < 10) {
      return this.hold("Insufficient candle data for DCA analysis");
    }

    // Use last 100 candles (or fewer if unavailable) to find recent high
    const recentCandles = minuteCandles.slice(-100);
    const recentHigh = Math.max(...recentCandles.map((c) => c.high));
    const dropPct = ((recentHigh - price) / recentHigh) * 100;

    // Count current entries from open positions
    const positionEntries = context.positions.filter(
      (p) =>
        p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
    ).length;

    const metadata = {
      price,
      recentHigh,
      dropPct,
      dropThresholdPct,
      positionEntries,
      maxEntries,
      baseAmount,
    };

    // Check if price dropped enough to warrant a new DCA entry
    if (dropPct >= dropThresholdPct && positionEntries < maxEntries) {
      return this.long(
        0.6 + Math.min(dropPct / 100, 0.2), // Higher confidence on bigger drops
        `Price dropped ${dropPct.toFixed(1)}% from recent high ${recentHigh.toFixed(2)} (entry ${positionEntries + 1}/${maxEntries})`,
        metadata,
      );
    }

    // Check if price has recovered above the estimated average entry
    // Use account returnPct as a proxy: positive return means price is above average entry
    if (positionEntries > 0 && context.account.returnPct > 0) {
      return this.close(
        0.6,
        `Price recovered above average entry (return: ${context.account.returnPct.toFixed(2)}%), taking profit`,
        metadata,
      );
    }

    if (positionEntries >= maxEntries) {
      return this.hold(
        `Max DCA entries reached (${positionEntries}/${maxEntries}), drop=${dropPct.toFixed(1)}%`,
      );
    }

    return this.hold(
      `Drop ${dropPct.toFixed(1)}% below threshold ${dropThresholdPct}% (entries: ${positionEntries}/${maxEntries})`,
    );
  }
}
