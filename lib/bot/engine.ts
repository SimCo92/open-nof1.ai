import type {
  BotConfig,
  Strategy,
  StrategyContext,
  Signal,
  OrderRequest,
  AccountState,
} from "./types";
import { BotError } from "./errors";
import { TypedEventEmitter } from "./events";
import { Logger } from "./logger";
import { BotMarketDataProvider } from "./market";
import { BotOrderManager } from "./orders";
import { BotRiskManager } from "./risk";
import { BotStateManager } from "./state";
import { createStrategy } from "./strategies";
import { binance } from "@/lib/trading/binance";

export class BotEngine {
  private config: BotConfig;
  private strategies: Map<string, Strategy> = new Map();
  private marketData: BotMarketDataProvider;
  private orderManager: BotOrderManager;
  private riskManager: BotRiskManager;
  private stateManager: BotStateManager;
  private emitter: TypedEventEmitter;
  private log: Logger;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  constructor(config: BotConfig) {
    this.config = config;
    this.log = Logger.fromConfig("bot-engine", config);
    this.emitter = new TypedEventEmitter();
    this.marketData = new BotMarketDataProvider(this.log);
    this.stateManager = new BotStateManager(config, this.log);
    this.orderManager = new BotOrderManager(
      "", // Will be set after state init
      this.log
    );
    this.riskManager = new BotRiskManager(
      config.risk,
      config.initialCapital,
      this.log
    );
  }

  get events(): TypedEventEmitter {
    return this.emitter;
  }

  async start(): Promise<void> {
    this.log.info("Starting bot", { botId: this.config.botId });

    // Initialize state (upsert DB record)
    await this.stateManager.initialize(this.config);

    // Verify bot instance exists
    const instance = await this.stateManager.loadState();
    if (!instance) throw new BotError("Failed to initialize bot state", false);

    // Initialize strategies
    for (const stratConfig of this.config.strategies) {
      if (!stratConfig.enabled) continue;
      const strategy = createStrategy(stratConfig);
      await strategy.initialize(stratConfig);
      this.strategies.set(stratConfig.id, strategy);
      this.log.info(`Strategy loaded: ${strategy.name}`, {
        id: stratConfig.id,
        type: stratConfig.type,
      });
    }

    // Update status
    await this.stateManager.updateStatus("running");
    this.emitter.emit("bot:started", {
      botId: this.config.botId,
      config: this.config,
    });

    // Reconcile orders from previous run
    await this.orderManager.syncWithExchange();

    // Start order sync timer
    this.syncTimer = setInterval(async () => {
      try {
        await this.orderManager.syncWithExchange();
      } catch (err) {
        this.log.warn("Order sync failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.config.orderSyncIntervalMs);

    // Start tick loop
    this.scheduleNextTick();
  }

  async stop(reason: string = "Manual stop"): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.log.info("Stopping bot", { reason });

    // Clear timers
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Cancel all open orders
    try {
      await this.orderManager.cancelAllOrders();
      this.log.info("All open orders cancelled");
    } catch (err) {
      this.log.error("Failed to cancel orders on shutdown", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Final order sync
    try {
      await this.orderManager.syncWithExchange();
    } catch {
      /* best effort */
    }

    // Cleanup strategies
    for (const strategy of this.strategies.values()) {
      try {
        await strategy.cleanup?.();
      } catch {
        /* best effort */
      }
    }

    await this.stateManager.updateStatus("stopped");
    this.emitter.emit("bot:stopped", {
      botId: this.config.botId,
      reason,
    });
    this.isShuttingDown = false;
  }

  async pause(): Promise<void> {
    this.log.info("Pausing bot");
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    await this.stateManager.updateStatus("paused");
  }

  async resume(): Promise<void> {
    this.log.info("Resuming bot");
    await this.stateManager.updateStatus("running");
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (this.isShuttingDown) return;
    this.tickTimer = setTimeout(
      () => this.tick(),
      this.config.tickIntervalMs
    );
  }

  private async tick(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      await this.executeTick();
      await this.stateManager.recordTick();
      this.emitter.emit("bot:tick", {
        botId: this.config.botId,
        tickNumber: 0, // TODO: track from state
        timestamp: new Date(),
      });
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      this.log.error("Tick failed", { error: err.message });
      this.emitter.emit("bot:error", {
        botId: this.config.botId,
        error: err,
      });

      if (error instanceof BotError && !error.recoverable) {
        await this.stateManager.updateStatus("error", err.message);
        return; // Don't schedule next tick
      }
    }

    this.scheduleNextTick();
  }

  private async executeTick(): Promise<void> {
    // 1. Check circuit breaker
    if (this.riskManager.isCircuitBroken()) {
      this.log.debug("Circuit breaker active, skipping tick");
      return;
    }

    // 2. Fetch account state
    const account = await this.getAccountState();

    // 3. For each symbol, for each strategy: evaluate and possibly execute
    for (const stratConfig of this.config.strategies) {
      if (!stratConfig.enabled) continue;
      const strategy = this.strategies.get(stratConfig.id);
      if (!strategy) continue;

      try {
        // Fetch market data for this strategy's symbol
        const marketData = await this.marketData.getSnapshot(
          stratConfig.symbol
        );
        const activeOrders = await this.orderManager.getActiveOrders(
          stratConfig.symbol
        );
        const positions = account.positions.filter(
          (p) => p.symbol === stratConfig.symbol
        );

        const context: StrategyContext = {
          marketData,
          account,
          activeOrders,
          positions,
          botConfig: this.config,
        };

        // Evaluate strategy
        const signal = await strategy.evaluate(context);
        this.emitter.emit("signal:generated", {
          strategyId: stratConfig.id,
          signal,
        });

        if (signal.direction === "HOLD") continue;

        // Build order request from signal
        const request = this.signalToOrderRequest(signal, context);
        if (!request) continue;

        // Risk check
        const riskResult = await this.riskManager.checkPreTrade(
          signal,
          request,
          context
        );
        if (!riskResult.approved) {
          this.log.info("Signal rejected by risk", {
            strategyId: stratConfig.id,
            reason: riskResult.reason,
          });
          this.emitter.emit("signal:rejected", {
            strategyId: stratConfig.id,
            signal,
            reason: riskResult.reason,
          });
          continue;
        }

        const finalRequest = riskResult.adjustedRequest || request;

        // Place the order
        const order = await this.orderManager.placeOrder(
          finalRequest,
          stratConfig.id,
          "entry"
        );
        this.emitter.emit("order:placed", { order });

        // Post-trade: generate SL/TP orders
        if (order.status !== "failed" && signal.direction !== "CLOSE") {
          const protectionOrders =
            await this.riskManager.checkPostTrade(order, context);
          for (const protOrder of protectionOrders) {
            const protTag =
              protOrder.type === "stop"
                ? ("stop_loss" as const)
                : protOrder.type === "trailing_stop"
                  ? ("trailing_stop" as const)
                  : ("take_profit" as const);
            await this.orderManager.placeOrder(
              protOrder,
              stratConfig.id,
              protTag
            );
          }
        }
      } catch (error) {
        this.log.error(`Strategy ${stratConfig.id} failed`, {
          error:
            error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private signalToOrderRequest(
    signal: Signal,
    context: StrategyContext
  ): OrderRequest | null {
    const price = context.marketData.price;
    if (!price) return null;

    switch (signal.direction) {
      case "LONG":
        return {
          symbol: signal.symbol,
          side: "buy",
          type: "market",
          quantity:
            (signal.metadata?.amount as number) ||
            (context.account.availableBalance *
              (this.config.risk.maxPositionSizePct / 100)) /
              price,
        };

      case "SHORT":
        return {
          symbol: signal.symbol,
          side: "sell",
          type: "market",
          quantity:
            (signal.metadata?.amount as number) ||
            (context.account.availableBalance *
              (this.config.risk.maxPositionSizePct / 100)) /
              price,
        };

      case "CLOSE": {
        const position = context.positions.find(
          (p) => p.contracts && p.contracts > 0
        );
        if (!position) return null;
        const percentage =
          (signal.metadata?.percentage as number) || 100;
        return {
          symbol: signal.symbol,
          side: position.side === "long" ? "sell" : "buy",
          type: "market",
          quantity: (position.contracts! * percentage) / 100,
          reduceOnly: true,
        };
      }

      default:
        return null;
    }
  }

  private async getAccountState(): Promise<AccountState> {
    const [balance, positions] = await Promise.all([
      binance.fetchBalance({ type: "future" }),
      binance.fetchPositions(this.config.symbols),
    ]);

    const totalBalance = balance.USDT?.total || 0;
    const availableBalance = balance.USDT?.free || 0;
    const totalUnrealizedPnl = positions.reduce(
      (sum, p) => sum + (p.unrealizedPnl || 0),
      0
    );

    return {
      totalBalance,
      availableBalance,
      totalUnrealizedPnl,
      positions,
      initialCapital: this.config.initialCapital,
      returnPct:
        (totalBalance - this.config.initialCapital) /
        this.config.initialCapital,
    };
  }
}
