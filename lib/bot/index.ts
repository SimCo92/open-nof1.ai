import { BotEngine } from "./engine";
import { loadBotConfig, type BotConfigInput } from "./config";

export function createBot(overrides?: Partial<BotConfigInput>): BotEngine {
  const config = loadBotConfig(overrides);
  return new BotEngine(config);
}

export { BotEngine } from "./engine";
export { loadBotConfig } from "./config";
export { registerStrategy, createStrategy } from "./strategies";
export type {
  BotConfig,
  BotState,
  Strategy,
  StrategyConfig,
  Signal,
  TrackedOrder,
} from "./types";
