import type { RiskConfig } from "../types";
import { Logger } from "../logger";

export interface CircuitBreakerResult {
  broken: boolean;
  reason?: string;
}

export interface CircuitBreakerState {
  consecutiveLosses: number;
  dailyPnl: number;
  dailyPnlResetAt: Date;
  brokenUntil: Date | null;
}

export class CircuitBreaker {
  private consecutiveLosses = 0;
  private dailyPnl = 0;
  private dailyPnlResetAt: Date;
  private brokenUntil: Date | null = null;

  constructor(
    private readonly config: RiskConfig["circuitBreaker"],
    private readonly logger: Logger
  ) {
    this.dailyPnlResetAt = CircuitBreaker.nextMidnightUTC();
  }

  /**
   * Returns true if the circuit breaker is currently tripped.
   */
  isBroken(): boolean {
    if (!this.brokenUntil) return false;
    if (new Date() >= this.brokenUntil) {
      this.brokenUntil = null;
      return false;
    }
    return true;
  }

  /**
   * Record a trade result and check whether the breaker should trip.
   * Returns the breaker status after evaluation.
   */
  recordResult(pnl: number, initialCapital: number): CircuitBreakerResult {
    this.resetDailyPnlIfNeeded();

    if (pnl < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }

    this.dailyPnl += pnl;

    // Check consecutive-loss trigger
    if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      return this.trip(
        `${this.consecutiveLosses} consecutive losses (limit: ${this.config.maxConsecutiveLosses})`
      );
    }

    // Check daily-loss trigger
    if (
      this.dailyPnl < 0 &&
      (Math.abs(this.dailyPnl) / initialCapital) * 100 >=
        this.config.dailyLossLimitPct
    ) {
      const lossPct = ((Math.abs(this.dailyPnl) / initialCapital) * 100).toFixed(2);
      return this.trip(
        `Daily loss ${lossPct}% exceeds limit of ${this.config.dailyLossLimitPct}%`
      );
    }

    return { broken: false };
  }

  /**
   * Manually reset the circuit breaker.
   */
  reset(): void {
    this.brokenUntil = null;
    this.consecutiveLosses = 0;
    this.logger.info("Circuit breaker manually reset");
  }

  /**
   * Return the current internal state for monitoring or persistence.
   */
  getState(): CircuitBreakerState {
    return {
      consecutiveLosses: this.consecutiveLosses,
      dailyPnl: this.dailyPnl,
      dailyPnlResetAt: this.dailyPnlResetAt,
      brokenUntil: this.brokenUntil,
    };
  }

  /**
   * Restore state from a previous snapshot (e.g., after crash recovery).
   */
  loadState(state: CircuitBreakerState): void {
    this.consecutiveLosses = state.consecutiveLosses;
    this.dailyPnl = state.dailyPnl;
    this.dailyPnlResetAt = new Date(state.dailyPnlResetAt);
    this.brokenUntil = state.brokenUntil ? new Date(state.brokenUntil) : null;
    this.logger.info("Circuit breaker state restored", {
      consecutiveLosses: this.consecutiveLosses,
      dailyPnl: this.dailyPnl,
      brokenUntil: this.brokenUntil?.toISOString() ?? null,
    });
  }

  // ── Private ────────────────────────────────────────────────────────

  private trip(reason: string): CircuitBreakerResult {
    this.brokenUntil = new Date(
      Date.now() + this.config.cooldownMinutes * 60_000
    );
    this.logger.error("Circuit breaker tripped", {
      reason,
      brokenUntil: this.brokenUntil.toISOString(),
    });
    return { broken: true, reason };
  }

  private resetDailyPnlIfNeeded(): void {
    if (new Date() >= this.dailyPnlResetAt) {
      this.dailyPnl = 0;
      this.dailyPnlResetAt = CircuitBreaker.nextMidnightUTC();
      this.logger.debug("Daily P&L counter reset");
    }
  }

  private static nextMidnightUTC(): Date {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0
      )
    );
    return next;
  }
}
