import { BotOrderStatus } from "@prisma/client";
import type { Order } from "ccxt";

import { binance } from "@/lib/trading/binance";
import { prisma } from "@/lib/prisma";
import type { TrackedOrder, OrderStatus } from "../types";
import { Logger } from "../logger";

/** Maps a CCXT order status string to our internal BotOrderStatus enum. */
function ccxtStatusToPrisma(status: string): BotOrderStatus | null {
  switch (status) {
    case "closed":
      return BotOrderStatus.Filled;
    case "canceled":
    case "cancelled":
      return BotOrderStatus.Cancelled;
    case "expired":
      return BotOrderStatus.Expired;
    case "open":
      return null; // open orders need further inspection for partial fills
    default:
      return null;
  }
}

/** Maps Prisma BotOrderStatus to our local OrderStatus type. */
function prismaStatusToLocal(status: BotOrderStatus): OrderStatus {
  const map: Record<BotOrderStatus, OrderStatus> = {
    [BotOrderStatus.Pending]: "pending",
    [BotOrderStatus.Placed]: "placed",
    [BotOrderStatus.PartiallyFilled]: "partially_filled",
    [BotOrderStatus.Filled]: "filled",
    [BotOrderStatus.Cancelled]: "cancelled",
    [BotOrderStatus.Failed]: "failed",
    [BotOrderStatus.Expired]: "expired",
  };
  return map[status];
}

/** Converts a Prisma BotOrder row to a TrackedOrder. */
function toTrackedOrder(
  row: Awaited<ReturnType<typeof prisma.botOrder.findUniqueOrThrow>>
): TrackedOrder {
  return {
    id: row.id,
    exchangeOrderId: row.exchangeOrderId ?? undefined,
    request: {
      symbol: row.symbol,
      side: row.side as TrackedOrder["request"]["side"],
      type: row.type as TrackedOrder["request"]["type"],
      quantity: row.requestedQuantity,
      price: row.requestedPrice ?? undefined,
      stopPrice: row.stopPrice ?? undefined,
      trailingDelta: row.trailingDelta ?? undefined,
      reduceOnly: row.reduceOnly,
    },
    status: prismaStatusToLocal(row.status),
    filledQuantity: row.filledQuantity,
    averagePrice: row.averagePrice ?? undefined,
    fees: row.fees ?? undefined,
    parentOrderId: row.parentOrderId ?? undefined,
    tag: row.tag as TrackedOrder["tag"],
    strategyId: row.strategyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    error: row.error ?? undefined,
  };
}

export { toTrackedOrder, prismaStatusToLocal };

/**
 * Polls the exchange for order status updates and persists changes to the DB.
 *
 * Each active order is synced independently -- a failure on one order will not
 * block the others.
 */
export class OrderTracker {
  private readonly logger: Logger;

  constructor(
    private readonly botInstanceId: string,
    logger: Logger
  ) {
    this.logger = logger.child("OrderTracker");
  }

  /**
   * Fetches every Placed / PartiallyFilled order for this bot instance and
   * reconciles its state with the exchange. Returns only the orders whose
   * status changed during this sync cycle.
   */
  async syncOrders(): Promise<TrackedOrder[]> {
    const activeOrders = await prisma.botOrder.findMany({
      where: {
        botInstanceId: this.botInstanceId,
        status: { in: [BotOrderStatus.Placed, BotOrderStatus.PartiallyFilled] },
      },
    });

    if (activeOrders.length === 0) return [];

    this.logger.debug("Syncing orders with exchange", {
      count: activeOrders.length,
    });

    const changed: TrackedOrder[] = [];

    for (const order of activeOrders) {
      try {
        const updated = await this.syncSingleOrder(order);
        if (updated) changed.push(updated);
      } catch (err) {
        this.logger.error("Unexpected error syncing order", {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (changed.length > 0) {
      this.logger.info("Order sync complete", {
        synced: activeOrders.length,
        changed: changed.length,
      });
    }

    return changed;
  }

  /**
   * Syncs a single order with the exchange and updates the DB if the status
   * changed. Returns the updated TrackedOrder when a change occurred, or null
   * if nothing changed.
   */
  private async syncSingleOrder(
    order: Awaited<ReturnType<typeof prisma.botOrder.findUniqueOrThrow>>
  ): Promise<TrackedOrder | null> {
    if (!order.exchangeOrderId) {
      this.logger.warn("Order has no exchangeOrderId, marking as Failed", {
        orderId: order.id,
      });
      const updated = await prisma.botOrder.update({
        where: { id: order.id },
        data: { status: BotOrderStatus.Failed, error: "Missing exchangeOrderId" },
      });
      return toTrackedOrder(updated);
    }

    let exchangeOrder: Order;
    try {
      exchangeOrder = await binance.fetchOrder(order.exchangeOrderId, order.symbol);
    } catch (err) {
      // Order not found on exchange -- mark as Failed.
      this.logger.warn("Order not found on exchange", {
        orderId: order.id,
        exchangeOrderId: order.exchangeOrderId,
        error: err instanceof Error ? err.message : String(err),
      });
      const updated = await prisma.botOrder.update({
        where: { id: order.id },
        data: {
          status: BotOrderStatus.Failed,
          error: `Exchange fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      return toTrackedOrder(updated);
    }

    const newPrismaStatus = ccxtStatusToPrisma(exchangeOrder.status);
    const filled = exchangeOrder.filled ?? 0;
    const average = exchangeOrder.average ?? undefined;
    const feeCost = exchangeOrder.fee?.cost ?? undefined;

    // Determine the target DB status.
    let targetStatus: BotOrderStatus;
    if (newPrismaStatus) {
      targetStatus = newPrismaStatus;
    } else if (filled > 0 && filled < (exchangeOrder.amount ?? order.requestedQuantity)) {
      targetStatus = BotOrderStatus.PartiallyFilled;
    } else {
      // Still fully open with no fills -- no change.
      return null;
    }

    // Check whether anything actually changed.
    const statusChanged = targetStatus !== order.status;
    const fillChanged = filled !== order.filledQuantity;
    if (!statusChanged && !fillChanged) return null;

    const updated = await prisma.botOrder.update({
      where: { id: order.id },
      data: {
        status: targetStatus,
        filledQuantity: filled,
        averagePrice: average,
        fees: feeCost,
      },
    });

    this.logger.info("Order status updated", {
      orderId: order.id,
      from: order.status,
      to: targetStatus,
      filled,
    });

    return toTrackedOrder(updated);
  }
}
