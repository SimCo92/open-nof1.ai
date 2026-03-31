import type { BotConfig } from "./types";

type LogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private minLevel: number;
  private context: string;

  constructor(context: string, level: LogLevel = "info") {
    this.context = context;
    this.minLevel = LOG_LEVELS[level];
  }

  static fromConfig(context: string, config: Pick<BotConfig, "logging">) {
    return new Logger(context, config.logging.level);
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log("debug", message, data);
  }
  info(message: string, data?: Record<string, unknown>) {
    this.log("info", message, data);
  }
  warn(message: string, data?: Record<string, unknown>) {
    this.log("warn", message, data);
  }
  error(message: string, data?: Record<string, unknown>) {
    this.log("error", message, data);
  }

  child(subContext: string) {
    return new Logger(
      `${this.context}:${subContext}`,
      (Object.entries(LOG_LEVELS).find(
        ([, v]) => v === this.minLevel
      )?.[0] as LogLevel) ?? "info"
    );
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ) {
    if (LOG_LEVELS[level] < this.minLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...data,
    };
    const method =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    method(JSON.stringify(entry));
  }
}
