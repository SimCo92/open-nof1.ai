import { MarketState } from "@/lib/trading/current-market-state";
import { MetricData } from "./metrics";

export interface ApiResponse<T> {
  data: T;
  success: boolean;
}

export interface CryptoPricing {
  btc: MarketState;
  eth: MarketState;
  sol: MarketState;
  doge: MarketState;
  bnb: MarketState;
}

export interface MetricsData {
  metrics: MetricData[];
  totalCount: number;
  model: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type MetricsResponse = ApiResponse<MetricsData>;
export type PricingResponse = ApiResponse<{ pricing: CryptoPricing }>;
