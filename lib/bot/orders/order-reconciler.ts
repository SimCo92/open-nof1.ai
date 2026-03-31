import { BotOrderStatus } from "@prisma/client";
import type { Order } from "ccxt";

import { binance } from "@/lib/trading/binance";
import { prisma } from "@/lib/prisma";
import type { TrackedOrder } from "../types";
import { Logger } from "../logger";
import { toTrackedOrder } from "./order-tracker";

/**
 * Reconciles local DB state with the exchange.
 *
 * Designed to run on startup or after a crash/reconnect, this class detects
 * orders that were filled or cancelled while the bot was offline and updates
 * the database accordingly.
 */
export class OrderReconciler {
  private readonly logger: Logger;

  constructor(
    private readonly botInstanceId: string,
    logger: Logger
  ) {
    this.logger = logger.child("OrderReconciler");
  }

  /**
   * Compares orders held in the DB against what the exchange currently reports
   * and brings the two into agreement.
   *
   * 1. Fetches all open orders from the exchange.
   * 2. Fetches all Placed/PartiallyFilled orders from the DB.
   * 3. For DB orders that are no longer open on the exchange, queries the
   *    exchange for their final status and persists it.
   * 4. Logs a warning for exchange orders not tracked in the DB.
   *
   * Returns every order whose DB status was updated during reconciliation.
   */
  async reconcile(): Promise<TrackedOrder[]> {
    this.logger.info("Starting order reconciliation");

    // 1. Fetch current open orders from the exchange.
    let exchangeOpenOrders: Order[];
    try {
      exchangeOpenOrders = await binance.fetchOpenOrders();
    } catch (err) {
      this.logger.error("Failed to fetch open orders from exchange", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }

    const exchangeOrderIds = new Set(
      exchangeOpenOrders.map((o) => o.id).filter(Boolean)
    );

    // 2. Fetch DB orders that we consider "active".
    const dbOrders = await prisma.botOrder.findMany({
      where: {
        botInstanceId: this.botInstanceId,
        status: { in: [BotOrderStatus.Placed, BotOrderStatus.PartiallyFilled] },
      },
    });

    const dbExchangeOrderIds = new Set(
      dbOrders.map((o) => o.exchangeOrderId).filter(Boolean)
    );

    // 3. Detect exchange orders that have no matching DB record.
    for (const exOrder of exchangeOpenOrders) {
      if (exOrder.id && !dbExchangeOrderIds.has(exOrder.id)) {
        this.logger.warn("Unknown order found on exchange (not in DB)", {
          exchangeOrderId: exOrder.id,
          symbol: exOrder.symbol,
          side: exOrder.side,
          amount: exOrder.amount,
          status: exOrder.status,
        });
      }
    }

    // 4. For DB orders missing from the exchange, fetch their final status.
    const reconciled: TrackedOrder[] = [];

    for (const order of dbOrders) {
      if (!order.exchangeOrderId) {
        // No exchange ID means the order was never confirmed -- mark as Failed.
        const updated = await prisma.botOrder.update({
          where: { id: order.id },
          data: {
            status: BotOrderStatus.Failed,
            error: "Missing exchangeOrderId during reconciliation",
          },
        });
        reconciled.push(toTrackedOrder(updated));
        continue;
      }

      // If the exchange still lists this order as open, nothing to reconcile.
      if (exchangeOrderIds.has(order.exchangeOrderId)) continue;

      // The order is no longer open on the exchange -- query for final state.
      try {
        const finalOrder = await binance.fetchOrder(
          order.exchangeOrderId,
          order.symbol
        );

        const newStatus = this.resolveStatus(finalOrder);
        const updated = await prisma.botOrder.update({
          where: { id: order.id },
          data: {
            status: newStatus,
            filledQuantity: finalOrder.filled ?? 0,
            averagePrice: finalOrder.average ?? undefined,
            fees: finalOrder.fee?.cost ?? undefined,
          },
        });

        this.logger.info("Reconciled order", {
          orderId: order.id,
          exchangeOrderId: order.exchangeOrderId,
          previousStatus: order.status,
          newStatus,
        });

        reconciled.push(toTrackedOrder(updated));
      } catch (err) {
        this.logger.error("Failed to reconcile order", {
          orderId: order.id,
          exchangeOrderId: order.exchangeOrderId,
          error: err instanceof Error ? err.message : String(err),
        });

        const updated = await prisma.botOrder.update({
          where: { id: order.id },
          data: {
            status: BotOrderStatus.Failed,
            error: `Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        reconciled.push(toTrackedOrder(updated));
      }
    }

    this.logger.info("Order reconciliation complete", {
      dbActive: dbOrders.length,
      exchangeOpen: exchangeOpenOrders.length,
      reconciled: reconciled.length,
    });

    return reconciled;
  }

  /** Derives the correct BotOrderStatus from a CCXT order object. */
  private resolveStatus(order: Order): BotOrderStatus {
    switch (order.status) {
      case "closed":
        return BotOrderStatus.Filled;
      case "canceled":
      case "cancelled":
        return BotOrderStatus.Cancelled;
      case "expired":
        return BotOrderStatus.Expired;
      default:
        // If the exchange still considers it open but we didn't see it in the
        // open-orders list, treat partial fills as PartiallyFilled.
        if (order.filled && order.filled > 0) {
          return BotOrderStatus.PartiallyFilled;
        }
        return BotOrderStatus.Placed;
    }
  }
}
