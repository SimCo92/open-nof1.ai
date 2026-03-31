import { useEffect, useState, useCallback } from "react";
import type { CryptoPricing, PricingResponse } from "@/lib/types/api";

const POLL_INTERVAL = 10_000;

export function usePricing() {
  const [pricing, setPricing] = useState<CryptoPricing | null>(null);

  const fetchPricing = useCallback(async () => {
    try {
      const response = await fetch("/api/pricing");
      if (!response.ok) return;

      const data: PricingResponse = await response.json();
      if (data.success && data.data.pricing) {
        setPricing(data.data.pricing);
      }
    } catch (err) {
      console.error("Error fetching pricing:", err);
    }
  }, []);

  useEffect(() => {
    fetchPricing();
    const interval = setInterval(fetchPricing, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchPricing]);

  return { pricing };
}
