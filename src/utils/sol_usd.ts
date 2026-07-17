import { crypull } from "crypull";
import { CONFIG } from "../config";

const SOL_MINT = "So11111111111111111111111111111111111111112";
let cached: { rate: number; timestamp: number } | null = null;

export async function getSolUsdRate(): Promise<number> {
  if (cached && Date.now() - cached.timestamp < 60_000) {
    return cached.rate;
  }

  try {
    const data = await crypull.price("SOL");
    if (data?.priceUsd && data.priceUsd > 0) {
      cached = { rate: data.priceUsd, timestamp: Date.now() };
      return data.priceUsd;
    }
  } catch {}

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CONFIG.jupiterApiKey) headers["x-api-key"] = CONFIG.jupiterApiKey;

    const res = await fetch(
      `https://api.jup.ag/price/v3?ids=${SOL_MINT}`,
      { headers, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const body = (await res.json()) as Record<string, { usdPrice: number }>;
      const rate = body[SOL_MINT]?.usdPrice;
      if (Number.isFinite(rate) && rate > 0) {
        cached = { rate, timestamp: Date.now() };
        return rate;
      }
    }
  } catch {}

  return 150;
}
