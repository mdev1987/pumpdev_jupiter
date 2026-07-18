import { getSolUsdRate } from "../utils/sol_usd";
import { CONFIG } from "../config";

export interface PriceProvider {
  getPrice(mint: string): Promise<number | null>;
}

export class PumpDevPriceProvider implements PriceProvider {
  private cache = new Map<string, { price: number; timestamp: number }>();

  updatePrice(mint: string, price: number) {
    this.cache.set(mint, { price, timestamp: Date.now() });
  }

  async getPrice(mint: string): Promise<number | null> {
    const c = this.cache.get(mint);
    if (c && Date.now() - c.timestamp < 30_000) return c.price;
    return c?.price ?? null;
  }
}

import https from "node:https";

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

export class JupiterPriceProvider implements PriceProvider {
  async getPrice(mint: string): Promise<number | null> {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (CONFIG.jupiterApiKey) headers["x-api-key"] = CONFIG.jupiterApiKey;

      const text = await httpsGet(
        `https://api.jup.ag/price/v3?ids=${mint}`,
        headers,
      );

      const data = JSON.parse(text) as Record<string, { usdPrice: number }>;
      const entry = data[mint];
      const tokenPriceUSD = entry?.usdPrice;
      if (!tokenPriceUSD || !Number.isFinite(tokenPriceUSD) || tokenPriceUSD <= 0) return null;

      const solUsd = await getSolUsdRate();
      return tokenPriceUSD / solUsd;
    } catch (err) {
      console.warn(`[Jupiter] price fetch failed for ${mint}:`, err);
      return null;
    }
  }
}

export interface PriceResult {
  price: number;
  source: "pumpdev" | "jupiter";
}

export class PriceRouter implements PriceProvider {
  constructor(
    private pumpDev: PumpDevPriceProvider,
    private jupiter: JupiterPriceProvider,
  ) {}

  seedPrice(mint: string, priceSOL: number) {
    this.pumpDev.updatePrice(mint, priceSOL);
  }

  async getPrice(mint: string): Promise<number | null> {
    const r = await this.getPriceWithSource(mint);
    return r?.price ?? null;
  }

  async getPriceWithSource(mint: string): Promise<PriceResult | null> {
    const pd = await this.pumpDev.getPrice(mint);
    if (pd !== null && pd > 0) return { price: pd, source: "pumpdev" };

    const jp = await this.jupiter.getPrice(mint);
    if (jp !== null && jp > 0) return { price: jp, source: "jupiter" };

    return null;
  }
}
