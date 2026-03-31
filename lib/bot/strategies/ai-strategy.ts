import { AbstractStrategy } from "./base";
import type { StrategyConfig, StrategyContext, Signal } from "../types";
import { generateObject } from "ai";
import { z } from "zod";
import { deepseekR1 } from "@/lib/ai/model";
import { tradingPrompt, generateUserPrompt } from "@/lib/ai/prompt";
import { Opeartion } from "@prisma/client";
import type { MarketState } from "@/lib/trading/current-market-state";
import type { AccountInformationAndPerformance } from "@/lib/trading/account-information-and-performance";

export class AiStrategy extends AbstractStrategy {
  readonly name = "AI LLM Strategy";
  readonly version = "1.0.0";

  private invocationCount = 0;
  private startTime = new Date();

  async initialize(_config: StrategyConfig) {
    this.startTime = new Date();
    this.invocationCount = 0;
  }

  async evaluate(context: StrategyContext): Promise<Signal> {
    this.invocationCount++;

    try {
      // Build a MarketState-shaped object from our MarketDataSnapshot.
      // generateUserPrompt expects a MarketState and calls formatMarketState internally,
      // so we map the snapshot fields to the expected shape.
      const snap = context.marketData;
      const closes1m = snap.candles["1m"]?.map((c) => c.close) ?? [];

      const marketState: MarketState = {
        current_price: snap.price,
        current_ema20: snap.indicators.ema[20] ?? 0,
        current_macd: snap.indicators.macd?.value ?? 0,
        current_rsi: snap.indicators.rsi[7] ?? snap.indicators.rsi[14] ?? 0,
        open_interest: {
          latest: snap.openInterest,
          average: snap.openInterest,
        },
        funding_rate: snap.fundingRate,
        intraday: {
          mid_prices: closes1m.slice(-10),
          ema_20: closes1m.slice(-10).map(() => snap.indicators.ema[20] ?? 0),
          macd: closes1m.slice(-10).map(() => snap.indicators.macd?.value ?? 0),
          rsi_7: closes1m.slice(-10).map(() => snap.indicators.rsi[7] ?? 0),
          rsi_14: closes1m.slice(-10).map(() => snap.indicators.rsi[14] ?? 0),
        },
        longer_term: {
          ema_20: snap.indicators.ema[20] ?? 0,
          ema_50: snap.indicators.ema[50] ?? 0,
          atr_3: snap.indicators.atr[3] ?? 0,
          atr_14: snap.indicators.atr[14] ?? 0,
          current_volume: snap.candles["4h"]?.at(-1)?.volume ?? 0,
          average_volume: snap.candles["4h"]
            ? snap.candles["4h"].reduce((s, c) => s + c.volume, 0) /
              snap.candles["4h"].length
            : 0,
          macd: closes1m.slice(-10).map(() => snap.indicators.macd?.value ?? 0),
          rsi_14: closes1m.slice(-10).map(() => snap.indicators.rsi[14] ?? 0),
        },
      };

      // Build an AccountInformationAndPerformance-shaped object from the context.
      const accountPerf: AccountInformationAndPerformance = {
        currentTotalReturn: context.account.returnPct,
        availableCash: context.account.availableBalance,
        totalCashValue: context.account.totalBalance,
        positions: context.account.positions,
        currentPositionsValue: context.positions.reduce(
          (sum, p) => sum + (p.initialMargin || 0) + (p.unrealizedPnl || 0),
          0,
        ),
        contractValue: context.positions.reduce(
          (sum, p) => sum + (p.contracts || 0),
          0,
        ),
        sharpeRatio: 0,
      };

      const userPrompt = generateUserPrompt({
        currentMarketState: marketState,
        accountInformationAndPerformance: accountPerf,
        startTime: this.startTime,
        invocationCount: this.invocationCount,
      });

      const { object } = await generateObject({
        model: deepseekR1,
        system: tradingPrompt,
        prompt: userPrompt,
        output: "object",
        mode: "json",
        schema: z.object({
          opeartion: z.nativeEnum(Opeartion),
          buy: z
            .object({
              pricing: z.number(),
              amount: z.number(),
              leverage: z.number().min(1).max(20),
            })
            .optional(),
          sell: z
            .object({
              percentage: z.number().min(0).max(100),
            })
            .optional(),
          chat: z.string(),
        }),
      });

      switch (object.opeartion) {
        case Opeartion.Buy:
          return this.long(0.7, object.chat, {
            pricing: object.buy?.pricing,
            amount: object.buy?.amount,
            leverage: object.buy?.leverage,
          });

        case Opeartion.Sell:
          return this.close(0.7, object.chat, {
            percentage: object.sell?.percentage,
          });

        case Opeartion.Hold:
        default:
          return this.hold(object.chat);
      }
    } catch (error) {
      this.log.error("AI evaluation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.hold("AI evaluation failed, defaulting to hold");
    }
  }
}
