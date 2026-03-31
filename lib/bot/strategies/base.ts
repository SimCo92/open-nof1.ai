import type {
  Strategy,
  StrategyConfig,
  StrategyContext,
  Signal,
  MarketDataSnapshot,
  TrackedOrder,
} from "../types";
import { Logger } from "../logger";

export abstract class AbstractStrategy implements Strategy {
  abstract readonly name: string;
  abstract readonly version: string;

  readonly id: string;
  protected config: StrategyConfig;
  protected params: Record<string, unknown>;
  protected log: Logger;

  constructor(config: StrategyConfig) {
    this.id = config.id;
    this.config = config;
    this.params = config.parameters;
    this.log = new Logger(`strategy:${config.type}:${config.id}`);
  }

  async initialize(_config: StrategyConfig): Promise<void> {
    // Override in subclass if needed
  }

  abstract evaluate(context: StrategyContext): Promise<Signal>;

  async onOrderFilled(_order: TrackedOrder): Promise<void> {}
  async onOrderCancelled(_order: TrackedOrder): Promise<void> {}
  async cleanup(): Promise<void> {}

  // --- Signal helpers ---

  protected hold(reason: string): Signal {
    return {
      direction: "HOLD",
      symbol: this.config.symbol,
      confidence: 0,
      reason,
    };
  }

  protected long(
    confidence: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Signal {
    return {
      direction: "LONG",
      symbol: this.config.symbol,
      confidence,
      reason,
      metadata,
    };
  }

  protected short(
    confidence: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Signal {
    return {
      direction: "SHORT",
      symbol: this.config.symbol,
      confidence,
      reason,
      metadata,
    };
  }

  protected close(
    confidence: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Signal {
    return {
      direction: "CLOSE",
      symbol: this.config.symbol,
      confidence,
      reason,
      metadata,
    };
  }

  protected getIndicator(
    snapshot: MarketDataSnapshot,
    type: "ema" | "rsi" | "atr",
    period: number,
  ): number {
    return snapshot.indicators[type]?.[period] ?? 0;
  }
}
