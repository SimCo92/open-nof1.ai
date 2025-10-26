import { NextResponse } from "next/server";
import { getCurrentMarketState } from "@/lib/trading/current-market-state";

export const GET = async () => {
  try {
    // Fetch all cryptocurrency prices in parallel
    const [btcPricing, ethPricing, solPricing, dogePricing, bnbPricing] =
      await Promise.all([
        getCurrentMarketState("BTC/USDT"),
        getCurrentMarketState("ETH/USDT"),
        getCurrentMarketState("SOL/USDT"),
        getCurrentMarketState("DOGE/USDT"),
        getCurrentMarketState("BNB/USDT"),
      ]);

    return NextResponse.json({
      data: {
        pricing: {
          btc: btcPricing,
          eth: ethPricing,
          sol: solPricing,
          doge: dogePricing,
          bnb: bnbPricing,
        },
      },
      success: true,
    });
  } catch (error) {
    console.error("Error fetching pricing:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch pricing data",
        success: false,
      },
      { status: 500 }
    );
  }
};
