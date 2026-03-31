import type { Signal, StrategyContext, RiskConfig } from "../types";
import { Logger } from "../logger";

export class PositionSizer {
  constructor(
    private readonly config: RiskConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Calculate the maximum allowable position size (in quote currency)
   * given the current account state and risk limits.
   */
  calculateSize(signal: Signal, context: StrategyContext): number {
    const { account, positions } = context;

    const maxPerTrade =
      account.availableBalance * (this.config.maxPositionSizePct / 100);

    const currentExposure = positions.reduce((sum, pos) => {
      const contracts = Math.abs(Number(pos.contracts ?? 0));
      const mark = Number(pos.markPrice ?? 0);
      return sum + contracts * mark;
    }, 0);

    const maxTotalExposure =
      account.totalBalance * (this.config.maxTotalExposurePct / 100);
    const maxRemainingExposure = maxTotalExposure - currentExposure;

    const size = Math.min(maxPerTrade, maxRemainingExposure);

    this.logger.debug("Position size calculated", {
      symbol: signal.symbol,
      maxPerTrade,
      currentExposure,
      maxTotalExposure,
      maxRemainingExposure,
      finalSize: Math.max(size, 0),
    });

    return size > 0 ? size : 0;
  }

  /**
   * Cap a requested leverage value to the configured maximum.
   */
  capLeverage(requested: number): number {
    const capped = Math.min(requested, this.config.maxLeverage);
    if (capped < requested) {
      this.logger.warn("Leverage capped", {
        requested,
        capped,
        maxAllowed: this.config.maxLeverage,
      });
    }
    return capped;
  }
}
