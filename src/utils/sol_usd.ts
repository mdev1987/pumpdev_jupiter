import { crypull } from "crypull";
import { CONFIG } from "../config";

const SOL_MINT = "So11111111111111111111111111111111111111112";
let cached: { rate: number; timestamp: number } | null = null;

export async function getSolUsdRate(): Promise<number> {
  if (cached && Date.now() - cached.timestamp < 60_000) {
    return cached.rate;
  }

  // 1. PumpCoins SOL price
  try {
    const res = await fetch("https://pumpcoins.net/api/sol-price", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = (await res.json()) as { usd: number };
      if (Number.isFinite(body.usd) && body.usd > 0) {
        cached = { rate: body.usd, timestamp: Date.now() };
        return body.usd;
      }
    }
  } catch {}

  // 2. crypull
  try {
    const data = await crypull.price("SOL");
    if (data?.priceUsd && data.priceUsd > 0) {
      cached = { rate: data.priceUsd, timestamp: Date.now() };
      return data.priceUsd;
    }
  } catch {}

  // 3. Jupiter Price API v3
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CONFIG.jupiterApiKey) headers["x-api-key"] = CONFIG.jupiterApiKey;

    const res = await fetch(
      `https://api.jup.ag/price/v3?ids=${SOL_MINT}`,
      { headers, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const body = (await res.json()) as Record<string, { usdPrice: number }>;
      const entry = body[SOL_MINT];
      if (entry && Number.isFinite(entry.usdPrice) && entry.usdPrice > 0) {
        const rate = entry.usdPrice;
        cached = { rate, timestamp: Date.now() };
        return rate;
      }
    }
  } catch {}

  return 150;
}
