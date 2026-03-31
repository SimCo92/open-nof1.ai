export class BotError extends Error {
  constructor(
    message: string,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = "BotError";
  }
}

export class ExchangeError extends BotError {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message, true);
  }
}

export class RiskViolationError extends BotError {
  constructor(message: string) {
    super(message, false);
  }
}

export class StrategyError extends BotError {
  constructor(
    public readonly strategyId: string,
    message: string
  ) {
    super(message, true);
  }
}

export class ConfigError extends BotError {
  constructor(message: string) {
    super(message, false);
  }
}
