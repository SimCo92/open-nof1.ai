import type { Strategy, StrategyConfig } from "../types";
import { AiStrategy } from "./ai-strategy";
import { EmaCrossoverStrategy } from "./ema-crossover";
import { RsiStrategy } from "./rsi-strategy";
import { MacdStrategy } from "./macd-strategy";
import { BollingerStrategy } from "./bollinger-strategy";
import { GridStrategy } from "./grid-strategy";
import { DcaStrategy } from "./dca-strategy";

type StrategyFactory = (config: StrategyConfig) => Strategy;

const registry = new Map<string, StrategyFactory>();

export function registerStrategy(type: string, factory: StrategyFactory) {
  registry.set(type, factory);
}

export function createStrategy(config: StrategyConfig): Strategy {
  const factory = registry.get(config.type);
  if (!factory) {
    throw new Error(
      `Unknown strategy type: "${config.type}". Available: ${[...registry.keys()].join(", ")}`,
    );
  }
  return factory(config);
}

// Register built-in strategies
registerStrategy("ai", (c) => new AiStrategy(c));
registerStrategy("ema_crossover", (c) => new EmaCrossoverStrategy(c));
registerStrategy("rsi", (c) => new RsiStrategy(c));
registerStrategy("macd", (c) => new MacdStrategy(c));
registerStrategy("bollinger", (c) => new BollingerStrategy(c));
registerStrategy("grid", (c) => new GridStrategy(c));
registerStrategy("dca", (c) => new DcaStrategy(c));
