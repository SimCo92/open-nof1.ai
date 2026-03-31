import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class BollingerStrategy extends AbstractStrategy {
  readonly name = "Bollinger Bands Mean Reversion";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const minBandwidth = (this.params.minBandwidth as number) || 0.02;

    const { indicators, price } = context.marketData;
    const bands = indicators.bollingerBands;

    if (!bands) {
      return this.hold("Bollinger Bands data not available");
    }

    const { upper, middle, lower, bandwidth } = bands;
    const hasPosition = context.positions.some(
      (p) =>
        p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
    );

    const metadata = {
      price,
      upper,
      middle,
      lower,
      bandwidth,
      minBandwidth,
    };

    // Skip if bands are too narrow (squeeze) -- not enough volatility
    if (bandwidth < minBandwidth) {
      return this.hold(
        `Bollinger bandwidth ${bandwidth.toFixed(4)} below minimum ${minBandwidth}, squeeze in effect`,
      );
    }

    // Price below lower band: oversold bounce opportunity
    if (price < lower && !hasPosition) {
      return this.long(
        0.65,
        `Price ${price.toFixed(2)} below lower band ${lower.toFixed(2)} (bandwidth: ${bandwidth.toFixed(4)})`,
        metadata,
      );
    }

    // Price above upper band: take profit
    if (price > upper && hasPosition) {
      return this.close(
        0.7,
        `Price ${price.toFixed(2)} above upper band ${upper.toFixed(2)}`,
        metadata,
      );
    }

    // Price crossed above middle band from below: mean reversion target hit
    if (price > middle && hasPosition) {
      return this.close(
        0.55,
        `Price ${price.toFixed(2)} crossed above middle band ${middle.toFixed(2)}, mean reversion complete`,
        metadata,
      );
    }

    return this.hold(
      `Price=${price.toFixed(2)} bands=[${lower.toFixed(2)}, ${middle.toFixed(2)}, ${upper.toFixed(2)}] bw=${bandwidth.toFixed(4)}`,
    );
  }
}
