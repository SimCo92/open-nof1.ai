import { BotOrderStatus } from "@prisma/client";

import { binance } from "@/lib/trading/binance";
import { prisma } from "@/lib/prisma";
import type {
  OrderManager,
  OrderRequest,
  OrderTag,
  TrackedOrder,
} from "../types";
import { Logger } from "../logger";
import { OrderTracker, toTrackedOrder } from "./order-tracker";
import { OrderReconciler } from "./order-reconciler";

/** Active statuses that indicate an order is still "in-flight". */
const ACTIVE_STATUSES = [
  BotOrderStatus.Pending,
  BotOrderStatus.Placed,
  BotOrderStatus.PartiallyFilled,
] as const;

/**
 * Central order manager for a single bot instance.
 *
 * Handles order placement, cancellation, querying, and exchange
 * synchronization through the underlying OrderTracker and OrderReconciler.
 */
export class BotOrderManager implements OrderManager {
  private readonly tracker: OrderTracker;
  private readonly reconciler: OrderReconciler;
  private readonly logger: Logger;

  constructor(
    private readonly botInstanceId: string,
    logger: Logger
  ) {
    this.logger = logger.child("OrderManager");
    this.tracker = new OrderTracker(botInstanceId, logger);
    this.reconciler = new OrderReconciler(botInstanceId, logger);
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  async placeOrder(
    request: OrderRequest,
    strategyId: string,
    tag: OrderTag
  ): Promise<TrackedOrder> {
    // 1. Persist the order in Pending state before touching the exchange.
    const dbOrder = await prisma.botOrder.create({
      data: {
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        status: BotOrderStatus.Pending,
        tag,
        requestedQuantity: request.quantity,
        requestedPrice: request.price ?? null,
        stopPrice: request.stopPrice ?? null,
        trailingDelta: request.trailingDelta ?? null,
        reduceOnly: request.reduceOnly ?? false,
        strategyId,
        botInstanceId: this.botInstanceId,
      },
    });

    this.logger.info("Order created in DB", {
      orderId: dbOrder.id,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
    });

    // 2. Build CCXT params.
    const params: Record<string, unknown> = { ...(request.params ?? {}) };
    if (request.reduceOnly) {
      params.reduceOnly = true;
    }

    // 3. Submit to the exchange.
    try {
      const exchangeOrder = await this.submitToExchange(request, params);

      const updated = await prisma.botOrder.update({
        where: { id: dbOrder.id },
        data: {
          exchangeOrderId: String(exchangeOrder.id),
          status: BotOrderStatus.Placed,
          filledQuantity: exchangeOrder.filled ?? 0,
          averagePrice: exchangeOrder.average ?? undefined,
          fees: exchangeOrder.fee?.cost ?? undefined,
        },
      });

      this.logger.info("Order placed on exchange", {
        orderId: dbOrder.id,
        exchangeOrderId: exchangeOrder.id,
      });

      return toTrackedOrder(updated);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      const updated = await prisma.botOrder.update({
        where: { id: dbOrder.id },
        data: {
          status: BotOrderStatus.Failed,
          error: errorMessage,
        },
      });

      this.logger.error("Failed to place order on exchange", {
        orderId: dbOrder.id,
        error: errorMessage,
      });

      return toTrackedOrder(updated);
    }
  }

  /** Dispatches the order to the correct CCXT method based on order type. */
  private async submitToExchange(
    request: OrderRequest,
    params: Record<string, unknown>
  ) {
    const { symbol, side, quantity, price, stopPrice, trailingDelta, type } =
      request;

    switch (type) {
      case "market":
        return binance.createMarketOrder(symbol, side, quantity, undefined, params);

      case "limit":
        if (!price) throw new Error("Limit order requires a price");
        return side === "buy"
          ? binance.createLimitBuyOrder(symbol, quantity, price, params)
          : binance.createLimitSellOrder(symbol, quantity, price, params);

      case "stop":
      case "stop_limit":
        if (!stopPrice) throw new Error("Stop order requires a stopPrice");
        return binance.createOrder(symbol, "stop", side, quantity, undefined, {
          stopPrice,
          ...params,
        });

      case "trailing_stop":
        if (trailingDelta == null)
          throw new Error("Trailing stop requires a trailingDelta");
        return binance.createOrder(
          symbol,
          "trailing_stop_market",
          side,
          quantity,
          undefined,
          { callbackRate: trailingDelta / 100, ...params }
        );

      default: {
        const _exhaustive: never = type;
        throw new Error(`Unsupported order type: ${_exhaustive}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  async cancelOrder(orderId: string): Promise<void> {
    const order = await prisma.botOrder.findUniqueOrThrow({
      where: { id: orderId },
    });

    if (!order.exchangeOrderId) {
      // Never reached the exchange -- mark cancelled locally.
      await prisma.botOrder.update({
        where: { id: orderId },
        data: { status: BotOrderStatus.Cancelled },
      });
      this.logger.info("Order cancelled locally (no exchange ID)", { orderId });
      return;
    }

    try {
      await binance.cancelOrder(order.exchangeOrderId, order.symbol);

      await prisma.botOrder.update({
        where: { id: orderId },
        data: { status: BotOrderStatus.Cancelled },
      });

      this.logger.info("Order cancelled on exchange", {
        orderId,
        exchangeOrderId: order.exchangeOrderId,
      });
    } catch (err) {
      // The order may have been filled between our check and the cancel call.
      // Sync with the exchange to get the real state.
      this.logger.warn("Cancel failed, syncing order state", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.syncWithExchange();
    }
  }

  async cancelAllOrders(symbol?: string): Promise<void> {
    if (symbol) {
      try {
        await binance.cancelAllOrders(symbol);
      } catch (err) {
        this.logger.error("Failed to cancel all orders for symbol", {
          symbol,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await prisma.botOrder.updateMany({
        where: {
          botInstanceId: this.botInstanceId,
          symbol,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: { status: BotOrderStatus.Cancelled },
      });

      this.logger.info("Cancelled all orders for symbol", { symbol });
      return;
    }

    // No symbol specified: fetch all active orders and cancel per-symbol.
    const activeOrders = await prisma.botOrder.findMany({
      where: {
        botInstanceId: this.botInstanceId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      select: { symbol: true },
      distinct: ["symbol"],
    });

    for (const { symbol: sym } of activeOrders) {
      try {
        await binance.cancelAllOrders(sym);
      } catch (err) {
        this.logger.error("Failed to cancel all orders for symbol", {
          symbol: sym,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await prisma.botOrder.updateMany({
      where: {
        botInstanceId: this.botInstanceId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      data: { status: BotOrderStatus.Cancelled },
    });

    this.logger.info("Cancelled all orders for bot instance");
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getActiveOrders(symbol?: string): Promise<TrackedOrder[]> {
    const where: Parameters<typeof prisma.botOrder.findMany>[0] = {
      where: {
        botInstanceId: this.botInstanceId,
        status: { in: [...ACTIVE_STATUSES] },
        ...(symbol ? { symbol } : {}),
      },
      orderBy: { createdAt: "desc" as const },
    };

    const orders = await prisma.botOrder.findMany(where);
    return orders.map(toTrackedOrder);
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  async syncWithExchange(): Promise<void> {
    const changed = await this.tracker.syncOrders();

    if (changed.length > 0) {
      this.logger.info("Exchange sync detected changes", {
        changed: changed.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Reconciliation (startup / recovery)
  // ---------------------------------------------------------------------------

  /**
   * Runs a full reconciliation pass against the exchange.
   * Typically called once on bot startup.
   */
  async reconcile(): Promise<TrackedOrder[]> {
    return this.reconciler.reconcile();
  }
}

export { OrderTracker } from "./order-tracker";
export { OrderReconciler } from "./order-reconciler";
