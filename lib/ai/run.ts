import { generateObject } from "ai";
import { generateUserPrompt, tradingPrompt } from "./prompt";
import { getCurrentMarketState } from "../trading/current-market-state";
import { z } from "zod";
import { deepseekR1 } from "./model";
import { getAccountInformationAndPerformance } from "../trading/account-information-and-performance";
import { prisma } from "../prisma";
import { Opeartion } from "@prisma/client";
import { buy } from "../trading/buy";
import { sell } from "../trading/sell";
import { recordDecision } from "./record-decision";
import { TRADING_SYMBOL, getPrismaSymbol } from "../config/trading";

export async function run(initialCapital: number) {
  try {
    const [currentMarketState, accountInformationAndPerformance, invocationCount] =
      await Promise.all([
        getCurrentMarketState(TRADING_SYMBOL),
        getAccountInformationAndPerformance(initialCapital),
        prisma.chat.count(),
      ]);

    const userPrompt = generateUserPrompt({
      currentMarketState,
      accountInformationAndPerformance,
      startTime: new Date(),
      invocationCount,
    });

    const { object, reasoning } = await generateObject({
      model: deepseekR1,
      system: tradingPrompt,
      prompt: userPrompt,
      output: "object",
      mode: "json",
      schema: z.object({
        opeartion: z.nativeEnum(Opeartion),
        buy: z
          .object({
            pricing: z.number().describe("The pricing of you want to buy in."),
            amount: z.number(),
            leverage: z.number().min(1).max(20),
          })
          .optional()
          .describe("If opeartion is buy, generate object"),
        sell: z
          .object({
            percentage: z
              .number()
              .min(0)
              .max(100)
              .describe("Percentage of position to sell"),
          })
          .optional()
          .describe("If opeartion is sell, generate object"),
        adjustProfit: z
          .object({
            stopLoss: z
              .number()
              .optional()
              .describe("The stop loss of you want to set."),
            takeProfit: z
              .number()
              .optional()
              .describe("The take profit of you want to set."),
          })
          .optional()
          .describe(
            "If opeartion is hold and you want to adjust the profit, generate object"
          ),
        chat: z
          .string()
          .describe(
            "The reason why you do this opeartion, and tell me your anlyaise, for example: Currently holding all my positions in ETH, SOL, XRP, BTC, DOGE, and BNB as none of my invalidation conditions have been triggered, though XRP and BNB are showing slight unrealized losses. My overall account is up 10.51% with $4927.64 in cash, so I'll continue to monitor my existing trades."
          ),
      }),
    });

    const symbol = getPrismaSymbol(TRADING_SYMBOL);

    // Record decision to database first (ensures audit trail even if execution fails)
    await recordDecision({
      decision: object,
      reasoning: reasoning || "",
      userPrompt,
      symbol,
    });

    // Execute the trade
    if (object.opeartion === Opeartion.Buy) {
      const result = await buy({
        symbol: TRADING_SYMBOL,
        amount: object.buy?.amount ?? 0,
        leverage: object.buy?.leverage ?? 1,
        pricing: object.buy?.pricing,
      });
      console.log("Buy result:", result);
    }

    if (object.opeartion === Opeartion.Sell) {
      const result = await sell({
        symbol: TRADING_SYMBOL,
        percentage: object.sell?.percentage ?? 100,
      });
      console.log("Sell result:", result);
    }
  } catch (error) {
    console.error("AI run loop failed:", error);
    throw error;
  }
}
