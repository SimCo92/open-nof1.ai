import type {
  TrackedOrder,
  OrderRequest,
  OrderSide,
  StrategyContext,
  RiskConfig,
} from "../types";
import { Logger } from "../logger";

export class StopLossManager {
  constructor(
    private readonly config: RiskConfig,
    private readonly logger: Logger
  ) {}

  /**
   * After an entry order fills, generate protective stop-loss, take-profit,
   * and (optionally) trailing-stop order requests.
   */
  generateProtectionOrders(
    entryOrder: TrackedOrder,
    _context: StrategyContext
  ): OrderRequest[] {
    const { request, filledQuantity, averagePrice } = entryOrder;

    if (!averagePrice || filledQuantity <= 0) {
      this.logger.warn("Cannot generate protection orders: missing fill data", {
        orderId: entryOrder.id,
        averagePrice,
        filledQuantity,
      });
      return [];
    }

    const entrySide = request.side;
    const oppositeSide: OrderSide = entrySide === "buy" ? "sell" : "buy";
    const isLong = entrySide === "buy";

    const stopLossPrice = isLong
      ? averagePrice * (1 - this.config.defaultStopLossPct / 100)
      : averagePrice * (1 + this.config.defaultStopLossPct / 100);

    const takeProfitPrice = isLong
      ? averagePrice * (1 + this.config.defaultTakeProfitPct / 100)
      : averagePrice * (1 - this.config.defaultTakeProfitPct / 100);

    const orders: OrderRequest[] = [
      {
        symbol: request.symbol,
        side: oppositeSide,
        type: "stop",
        quantity: filledQuantity,
        stopPrice: stopLossPrice,
        reduceOnly: true,
      },
      {
        symbol: request.symbol,
        side: oppositeSide,
        type: "limit",
        quantity: filledQuantity,
        price: takeProfitPrice,
        reduceOnly: true,
      },
    ];

    if (this.config.trailingStopEnabled) {
      orders.push({
        symbol: request.symbol,
        side: oppositeSide,
        type: "trailing_stop",
        quantity: filledQuantity,
        trailingDelta: this.config.trailingStopDelta,
        reduceOnly: true,
      });
    }

    this.logger.info("Protection orders generated", {
      symbol: request.symbol,
      entrySide,
      averagePrice,
      stopLossPrice,
      takeProfitPrice,
      trailingStop: this.config.trailingStopEnabled,
      orderCount: orders.length,
    });

    return orders;
  }
}
