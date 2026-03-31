import { botConfigSchema, type BotConfigInput } from "./schema";
import type { BotConfig } from "../types";
import { ConfigError } from "../errors";

export function loadBotConfig(
  overrides: Partial<BotConfigInput> = {}
): BotConfig {
  const envConfig: Partial<BotConfigInput> = {
    botId: process.env.BOT_ID,
    exchange: {
      sandbox: process.env.BINANCE_USE_SANDBOX === "true",
    },
    symbols: process.env.TRADING_SYMBOL
      ? [process.env.TRADING_SYMBOL]
      : undefined,
    initialCapital: process.env.START_MONEY
      ? Number(process.env.START_MONEY)
      : undefined,
    tickIntervalMs: process.env.BOT_TICK_INTERVAL_MS
      ? Number(process.env.BOT_TICK_INTERVAL_MS)
      : undefined,
    risk: {
      maxPositionSizePct: process.env.BOT_MAX_POSITION_SIZE_PCT
        ? Number(process.env.BOT_MAX_POSITION_SIZE_PCT)
        : undefined,
      maxTotalExposurePct: process.env.BOT_MAX_EXPOSURE_PCT
        ? Number(process.env.BOT_MAX_EXPOSURE_PCT)
        : undefined,
      maxLeverage: process.env.BOT_MAX_LEVERAGE
        ? Number(process.env.BOT_MAX_LEVERAGE)
        : undefined,
      defaultStopLossPct: process.env.BOT_STOP_LOSS_PCT
        ? Number(process.env.BOT_STOP_LOSS_PCT)
        : undefined,
      defaultTakeProfitPct: process.env.BOT_TAKE_PROFIT_PCT
        ? Number(process.env.BOT_TAKE_PROFIT_PCT)
        : undefined,
      circuitBreaker: {
        maxConsecutiveLosses: process.env.BOT_CIRCUIT_BREAKER_LOSSES
          ? Number(process.env.BOT_CIRCUIT_BREAKER_LOSSES)
          : undefined,
        dailyLossLimitPct: process.env.BOT_DAILY_LOSS_LIMIT_PCT
          ? Number(process.env.BOT_DAILY_LOSS_LIMIT_PCT)
          : undefined,
      },
    },
  };

  // Strip undefined values before merging
  const cleaned = JSON.parse(JSON.stringify(envConfig));
  const merged = deepMerge(cleaned, overrides);

  const result = botConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(
      `Invalid bot configuration: ${result.error.message}`
    );
  }
  return result.data as BotConfig;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(
        (result[key] || {}) as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}
