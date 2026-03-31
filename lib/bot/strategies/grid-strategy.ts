import { AbstractStrategy } from "./base";
import type { StrategyContext, Signal } from "../types";

export class GridStrategy extends AbstractStrategy {
  readonly name = "Grid Trading";
  readonly version = "1.0.0";

  async evaluate(context: StrategyContext): Promise<Signal> {
    const gridSize = (this.params.gridSize as number) || 5;
    const gridSpacingPct = (this.params.gridSpacingPct as number) || 1;
    const orderSize = (this.params.orderSize as number) || 100;

    const { price } = context.marketData;
    const { activeOrders } = context;

    // Build grid levels centered around the current price
    const gridLevels = this.computeGridLevels(price, gridSize, gridSpacingPct);

    // Find the nearest uncovered grid level that the price has crossed
    const orderPrices = new Set(
      activeOrders
        .filter((o) => o.strategyId === this.id)
        .map((o) => o.request.price)
        .filter((p): p is number => p !== undefined),
    );

    // Check buy levels (below current price)
    for (const level of gridLevels) {
      if (level >= price) continue;
      if (this.isLevelCovered(level, orderPrices, gridSpacingPct)) continue;

      return this.long(
        0.6,
        `Price ${price.toFixed(2)} below grid level ${level.toFixed(2)}`,
        {
          gridLevel: level,
          price,
          gridSize,
          gridSpacingPct,
          orderSize,
          gridLevels,
          coveredLevels: [...orderPrices],
        },
      );
    }

    // Check sell levels (above current price)
    for (const level of gridLevels) {
      if (level <= price) continue;
      if (this.isLevelCovered(level, orderPrices, gridSpacingPct)) continue;

      const hasPosition = context.positions.some(
        (p) =>
          p.symbol === this.config.symbol && p.contracts && p.contracts > 0,
      );

      if (!hasPosition) continue;

      return this.close(
        0.6,
        `Price ${price.toFixed(2)} above grid level ${level.toFixed(2)}`,
        {
          gridLevel: level,
          price,
          gridSize,
          gridSpacingPct,
          orderSize,
          gridLevels,
          coveredLevels: [...orderPrices],
        },
      );
    }

    return this.hold(
      `All grid levels covered or no actionable level (price=${price.toFixed(2)}, levels=${gridSize})`,
    );
  }

  private computeGridLevels(
    centerPrice: number,
    gridSize: number,
    spacingPct: number,
  ): number[] {
    const levels: number[] = [];
    const halfGrid = Math.floor(gridSize / 2);

    for (let i = -halfGrid; i <= halfGrid; i++) {
      const level = centerPrice * (1 + (i * spacingPct) / 100);
      levels.push(level);
    }

    return levels.sort((a, b) => a - b);
  }

  private isLevelCovered(
    level: number,
    orderPrices: Set<number>,
    gridSpacingPct: number,
  ): boolean {
    // A level is considered covered if an order exists within half the grid spacing
    const tolerance = level * (gridSpacingPct / 200);
    for (const orderPrice of orderPrices) {
      if (Math.abs(orderPrice - level) < tolerance) {
        return true;
      }
    }
    return false;
  }
}
