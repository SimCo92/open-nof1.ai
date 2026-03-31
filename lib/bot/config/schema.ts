import { z } from "zod";

export const circuitBreakerConfigSchema = z.object({
  maxConsecutiveLosses: z.number().min(1).default(3),
  dailyLossLimitPct: z.number().min(0.1).max(100).default(5),
  cooldownMinutes: z.number().min(1).default(60),
});

export const riskConfigSchema = z.object({
  maxPositionSizePct: z.number().min(0.1).max(100).default(5),
  maxTotalExposurePct: z.number().min(1).max(100).default(30),
  maxLeverage: z.number().min(1).max(125).default(20),
  defaultStopLossPct: z.number().min(0.1).max(50).default(2),
  defaultTakeProfitPct: z.number().min(0.1).max(100).default(4),
  trailingStopEnabled: z.boolean().default(false),
  trailingStopActivationPct: z.number().default(1.5),
  trailingStopDelta: z.number().default(50),
  circuitBreaker: circuitBreakerConfigSchema.default({}),
});

export const strategyConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  symbol: z.string(),
  enabled: z.boolean().default(true),
  parameters: z.record(z.unknown()).default({}),
  riskOverrides: riskConfigSchema.partial().optional(),
});

export const botConfigSchema = z.object({
  botId: z.string().default("default"),
  exchange: z
    .object({
      sandbox: z.boolean().default(true),
    })
    .default({}),
  symbols: z.array(z.string()).min(1).default(["BTC/USDT"]),
  initialCapital: z.number().positive(),
  tickIntervalMs: z.number().min(10000).default(180000),
  orderSyncIntervalMs: z.number().min(5000).default(10000),
  strategies: z.array(strategyConfigSchema).min(1),
  risk: riskConfigSchema.default({}),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    })
    .default({}),
});

export type BotConfigInput = z.input<typeof botConfigSchema>;
