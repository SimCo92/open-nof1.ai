"use client";

import { MetricsChart } from "@/components/metrics-chart";
import { CryptoCard } from "@/components/crypto-card";
import { ModelsView } from "@/components/models-view";
import { Card } from "@/components/ui/card";
import { useMetrics } from "@/lib/hooks/use-metrics";
import { usePricing } from "@/lib/hooks/use-pricing";

export default function Home() {
  const { metricsData, totalCount, loading, lastUpdate } = useMetrics();
  const { pricing } = usePricing();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Open Nof1.ai
              <span className="text-muted-foreground text-sm ml-2">
                inspired by Alpha Arena
              </span>
            </h1>
            <p className="text-muted-foreground mt-2">
              Real-time trading metrics and performance
            </p>
          </div>
          {lastUpdate && (
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Last updated</div>
              <div className="text-lg font-mono">{lastUpdate}</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-8 border-b pb-4">
          <button className="text-sm font-medium border-b-2 border-primary pb-2">
            LIVE
          </button>
        </div>

        {/* Crypto Ticker */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {pricing ? (
            <>
              <CryptoCard
                symbol="BTC"
                name="Bitcoin"
                price={`$${pricing.btc.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="ETH"
                name="Ethereum"
                price={`$${pricing.eth.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="SOL"
                name="Solana"
                price={`$${pricing.sol.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="BNB"
                name="BNB"
                price={`$${pricing.bnb.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="DOGE"
                name="Dogecoin"
                price={`$${pricing.doge.current_price.toFixed(4)}`}
              />
            </>
          ) : (
            // Loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="h-20 bg-muted rounded"></div>
              </Card>
            ))
          )}
        </div>

        {/* Main Content - Chart and Models Side by Side */}
        <div className="flex flex-row gap-6">
          {/* Left: Chart */}
          <div className="flex-[2]">
            <MetricsChart
              metricsData={metricsData}
              loading={loading}
              lastUpdate={lastUpdate}
              totalCount={totalCount}
            />
          </div>

          {/* Right: Models View */}
          <div className="flex-1">
            <ModelsView />
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground pt-8 border-t">
          <p>HIGHEST: 🏆 DEEPSEEK CHAT</p>
          <p className="mt-2">nof1.ai - Real-time AI Trading Platform</p>
        </div>
      </div>
    </div>
  );
}
