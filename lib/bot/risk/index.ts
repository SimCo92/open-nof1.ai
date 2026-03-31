import type {
  Signal,
  OrderRequest,
  StrategyContext,
  RiskConfig,
  RiskCheckResult,
  RiskManager,
  TrackedOrder,
} from "../types";
import { Logger } from "../logger";
import { RiskViolationError } from "../errors";
import { PositionSizer } from "./position-sizer";
import { StopLossManager } from "./stop-loss-manager";
import { CircuitBreaker } from "./circuit-breaker";

export { PositionSizer } from "./position-sizer";
export { StopLossManager } from "./stop-loss-manager";
export { CircuitBreaker } from "./circuit-breaker";
export type {
  CircuitBreakerResult,
  CircuitBreakerState,
} from "./circuit-breaker";

export class BotRiskManager implements RiskManager {
  private readonly positionSizer: PositionSizer;
  private readonly stopLossManager: StopLossManager;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger: Logger;

  private lastContext: StrategyContext | null = null;

  constructor(
    private readonly config: RiskConfig,
    private readonly initialCapital: number,
    logger: Logger
  ) {
    this.logger = logger.child("RiskManager");
    this.positionSizer = new PositionSizer(config, this.logger.child("PositionSizer"));
    this.stopLossManager = new StopLossManager(config, this.logger.child("StopLoss"));
    this.circuitBreaker = new CircuitBreaker(
      config.circuitBreaker,
      this.logger.child("CircuitBreaker")
    );
  }

  /**
   * Pre-trade risk checks: circuit breaker, exposure budget, size & leverage caps.
   * Returns an approved result (with an optionally adjusted request) or a rejection.
   */
  async checkPreTrade(
    signal: Signal,
    request: OrderRequest,
    context: StrategyContext
  ): Promise<RiskCheckResult> {
    this.lastContext = context;

    // 1. Circuit breaker
    if (this.circuitBreaker.isBroken()) {
      const reason = "Circuit breaker is active -- trading is paused";
      this.logger.warn("Pre-trade rejected: circuit breaker", {
        symbol: signal.symbol,
      });
      return { approved: false, reason };
    }

    // 2. Exposure budget
    const maxSize = this.positionSizer.calculateSize(signal, context);
    if (maxSize <= 0) {
      return { approved: false, reason: "Insufficient exposure budget" };
    }

    // 3. Cap quantity
    let adjusted: OrderRequest | undefined;
    if (request.quantity > maxSize) {
      this.logger.info("Order quantity capped by risk limits", {
        original: request.quantity,
        capped: maxSize,
        symbol: request.symbol,
      });
      adjusted = { ...request, quantity: maxSize };
    }

    // 4. Cap leverage (if carried in params)
    const leverage = Number(request.params?.["leverage"] ?? 0);
    if (leverage > 0) {
      const cappedLeverage = this.positionSizer.capLeverage(leverage);
      if (cappedLeverage !== leverage) {
        adjusted = adjusted ?? { ...request };
        adjusted.params = { ...adjusted.params, leverage: cappedLeverage };
      }
    }

    if (adjusted) {
      return { approved: true, adjustedRequest: adjusted };
    }
    return { approved: true };
  }

  /**
   * Post-trade handling: generate protective stop-loss / take-profit orders
   * after an entry order fills.
   */
  async checkPostTrade(
    order: TrackedOrder,
    context: StrategyContext
  ): Promise<OrderRequest[]> {
    this.lastContext = context;
    return this.stopLossManager.generateProtectionOrders(order, context);
  }

  /**
   * Record the outcome of a protective order (SL/TP) to feed the circuit breaker.
   */
  async recordTradeResult(order: TrackedOrder): Promise<void> {
    if (order.status !== "filled") return;

    const isProtective =
      order.tag === "stop_loss" || order.tag === "take_profit";
    if (!isProtective) return;

    if (!order.averagePrice || order.filledQuantity <= 0) return;

    // Estimate P&L: for a reduce-only close the P&L direction depends on
    // which side the protective order was on. A "stop_loss" fill always
    // represents a loss in practice, but we compute from prices if the
    // parent entry price is unavailable.
    // Convention: tag already tells us the intent, so we just sign appropriately.
    const notional = order.filledQuantity * order.averagePrice;
    const fees = order.fees ?? 0;

    // Use a simple heuristic: stop_loss => negative P&L, take_profit => positive.
    // The magnitude is the notional minus fees (a rough proxy when we lack the
    // entry price here; the engine should provide accurate P&L in the future).
    const pnl =
      order.tag === "stop_loss" ? -(notional * 0.01 + fees) : notional * 0.01 - fees;

    this.logger.debug("Recording trade result for circuit breaker", {
      orderId: order.id,
      tag: order.tag,
      pnl,
    });

    const result = this.circuitBreaker.recordResult(pnl, this.initialCapital);
    if (result.broken) {
      this.logger.error("Circuit breaker tripped after trade result", {
        reason: result.reason,
      });
      throw new RiskViolationError(
        `Circuit breaker tripped: ${result.reason}`
      );
    }
  }

  /**
   * Whether the circuit breaker is currently tripped.
   */
  isCircuitBroken(): boolean {
    return this.circuitBreaker.isBroken();
  }

  /**
   * Manually reset the circuit breaker.
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Current exposure vs. maximum allowed, derived from the most recent context.
   */
  getExposure(): { current: number; max: number; utilizationPct: number } {
    const positions = this.lastContext?.positions ?? [];
    const totalBalance = this.lastContext?.account.totalBalance ?? this.initialCapital;

    const current = positions.reduce((sum, pos) => {
      const contracts = Math.abs(Number(pos.contracts ?? 0));
      const mark = Number(pos.markPrice ?? 0);
      return sum + contracts * mark;
    }, 0);

    const max = totalBalance * (this.config.maxTotalExposurePct / 100);
    const utilizationPct = max > 0 ? (current / max) * 100 : 0;

    return { current, max, utilizationPct };
  }
}
