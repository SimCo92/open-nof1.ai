import { Position } from "ccxt";

// Signal & Direction
export type SignalDirection = "LONG" | "SHORT" | "CLOSE" | "HOLD";

export interface Signal {
  direction: SignalDirection;
  symbol: string;
  confidence: number; // 0-1
  reason: string;
  metadata?: Record<string, unknown>;
}

// Order types
export type OrderSide = "buy" | "sell";
export type OrderType =
  | "market"
  | "limit"
  | "stop"
  | "stop_limit"
  | "trailing_stop";
export type OrderStatus =
  | "pending"
  | "placed"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "failed"
  | "expired";
export type OrderTag =
  | "entry"
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "grid"
  | "dca";

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  trailingDelta?: number;
  reduceOnly?: boolean;
  params?: Record<string, unknown>;
}

export interface TrackedOrder {
  id: string;
  exchangeOrderId?: string;
  request: OrderRequest;
  status: OrderStatus;
  filledQuantity: number;
  averagePrice?: number;
  fees?: number;
  parentOrderId?: string;
  tag: OrderTag;
  strategyId: string;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

// Strategy interface
export interface StrategyContext {
  marketData: MarketDataSnapshot;
  account: AccountState;
  activeOrders: TrackedOrder[];
  positions: Position[];
  botConfig: BotConfig;
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  initialize(config: StrategyConfig): Promise<void>;
  evaluate(context: StrategyContext): Promise<Signal>;
  onOrderFilled?(order: TrackedOrder): Promise<void>;
  onOrderCancelled?(order: TrackedOrder): Promise<void>;
  cleanup?(): Promise<void>;
}

export interface StrategyConfig {
  id: string;
  type: string;
  symbol: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  riskOverrides?: Partial<RiskConfig>;
}

// Risk management
export interface RiskConfig {
  maxPositionSizePct: number;
  maxTotalExposurePct: number;
  maxLeverage: number;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  trailingStopEnabled: boolean;
  trailingStopActivationPct: number;
  trailingStopDelta: number;
  circuitBreaker: {
    maxConsecutiveLosses: number;
    dailyLossLimitPct: number;
    cooldownMinutes: number;
  };
}

export type RiskCheckResult =
  | { approved: true; adjustedRequest?: OrderRequest }
  | { approved: false; reason: string };

export interface RiskManager {
  checkPreTrade(
    signal: Signal,
    request: OrderRequest,
    context: StrategyContext
  ): Promise<RiskCheckResult>;
  checkPostTrade(
    order: TrackedOrder,
    context: StrategyContext
  ): Promise<OrderRequest[]>;
  recordTradeResult(order: TrackedOrder): Promise<void>;
  isCircuitBroken(): boolean;
  resetCircuitBreaker(): void;
  getExposure(): { current: number; max: number; utilizationPct: number };
}

// Market data
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  ema: Record<number, number>;
  macd: { value: number; signal: number; histogram: number };
  rsi: Record<number, number>;
  atr: Record<number, number>;
  bollingerBands?: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
  };
}

export interface MarketDataSnapshot {
  symbol: string;
  timestamp: number;
  price: number;
  candles: Record<string, OHLCV[]>;
  indicators: IndicatorValues;
  fundingRate: number;
  openInterest: number;
}

export interface MarketDataProvider {
  getSnapshot(symbol: string): Promise<MarketDataSnapshot>;
  getCandles(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<OHLCV[]>;
  getPrice(symbol: string): Promise<number>;
}

// Order management
export interface OrderManager {
  placeOrder(
    request: OrderRequest,
    strategyId: string,
    tag: OrderTag
  ): Promise<TrackedOrder>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(symbol?: string): Promise<void>;
  getActiveOrders(symbol?: string): Promise<TrackedOrder[]>;
  syncWithExchange(): Promise<void>;
}

// Account state
export interface AccountState {
  totalBalance: number;
  availableBalance: number;
  totalUnrealizedPnl: number;
  positions: Position[];
  initialCapital: number;
  returnPct: number;
}

// Bot state
export type BotStatus = "idle" | "running" | "paused" | "stopped" | "error";

export interface BotState {
  botId: string;
  status: BotStatus;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastError: string | null;
  consecutiveLosses: number;
  dailyPnl: number;
  dailyPnlResetAt: Date;
  circuitBrokenUntil: Date | null;
  tickCount: number;
}

// Bot configuration
export interface BotConfig {
  botId: string;
  exchange: { sandbox: boolean };
  symbols: string[];
  initialCapital: number;
  tickIntervalMs: number;
  orderSyncIntervalMs: number;
  strategies: StrategyConfig[];
  risk: RiskConfig;
  logging: { level: "debug" | "info" | "warn" | "error" };
}

// Events
export interface BotEvents {
  "bot:started": { botId: string; config: BotConfig };
  "bot:stopped": { botId: string; reason: string };
  "bot:error": { botId: string; error: Error };
  "bot:tick": { botId: string; tickNumber: number; timestamp: Date };
  "signal:generated": { strategyId: string; signal: Signal };
  "signal:rejected": { strategyId: string; signal: Signal; reason: string };
  "order:placed": { order: TrackedOrder };
  "order:filled": { order: TrackedOrder };
  "order:cancelled": { order: TrackedOrder };
  "order:failed": { order: TrackedOrder; error: string };
  "risk:circuit_broken": { reason: string; until: Date };
  "risk:circuit_reset": Record<string, never>;
}
