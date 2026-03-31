import { prisma } from "../prisma";
import { Opeartion, Symbol } from "@prisma/client";

interface TradingDecision {
  opeartion: Opeartion;
  buy?: { pricing?: number; amount?: number; leverage?: number };
  sell?: { percentage?: number };
  adjustProfit?: { stopLoss?: number; takeProfit?: number };
  chat: string;
}

interface RecordParams {
  decision: TradingDecision;
  reasoning: string;
  userPrompt: string;
  symbol: Symbol;
}

export async function recordDecision({
  decision,
  reasoning,
  userPrompt,
  symbol,
}: RecordParams) {
  const tradingData = buildTradingData(decision, symbol);

  await prisma.chat.create({
    data: {
      reasoning: reasoning || "<no reasoning>",
      chat: decision.chat || "<no chat>",
      userPrompt,
      tradings: {
        createMany: { data: tradingData },
      },
    },
  });
}

function buildTradingData(decision: TradingDecision, symbol: Symbol) {
  const base = { symbol, opeartion: decision.opeartion };

  switch (decision.opeartion) {
    case Opeartion.Buy:
      return {
        ...base,
        pricing: decision.buy?.pricing,
        amount: decision.buy?.amount,
        leverage: decision.buy?.leverage,
      };

    case Opeartion.Sell:
      return {
        ...base,
        percentage: decision.sell?.percentage,
      };

    case Opeartion.Hold: {
      const shouldAdjust =
        decision.adjustProfit?.stopLoss || decision.adjustProfit?.takeProfit;
      return {
        ...base,
        stopLoss: shouldAdjust ? decision.adjustProfit?.stopLoss : undefined,
        takeProfit: shouldAdjust
          ? decision.adjustProfit?.takeProfit
          : undefined,
      };
    }
  }
}
