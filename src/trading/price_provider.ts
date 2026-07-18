import { getSolUsdRate } from "../utils/sol_usd";
import { CONFIG } from "../config";
import { crypull } from "crypull";

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

export class CrypullPriceProvider implements PriceProvider {
  async getPrice(mint: string): Promise<number | null> {
    try {
      const data = await crypull.price(mint, "solana");
      if (!data?.priceUsd || data.priceUsd <= 0) return null;
      const solUsd = await getSolUsdRate();
      return data.priceUsd / solUsd;
    } catch {
      return null;
    }
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


export interface DexScreenerPool {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string | null;
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  volume?: Record<string, number>;
  txns?: Record<string, { buys: number; sells: number }>;
  priceChange?: Record<string, number>;
  pairCreatedAt?: number;
}

export class DexScreenerPriceProvider implements PriceProvider {
  async getPools(mint: string): Promise<DexScreenerPool[]> {
    const text = await httpsGet(
      `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
      { Accept: "application/json" },
    );
    return JSON.parse(text) as DexScreenerPool[];
  }

  async getPrice(mint: string): Promise<number | null> {
    try {
      const pools = await this.getPools(mint);
      if (!pools.length) return null;
      const native = Number(pools[0]!.priceNative);
      if (!Number.isFinite(native) || native <= 0) return null;
      return native;
    } catch {
      return null;
    }
  }
}

export interface PriceResult {
  price: number;
  source: "crypull" | "dexscreener" | "jupiter";
}

export class PriceRouter implements PriceProvider {
  constructor(
    private crypull: CrypullPriceProvider,
    private dexscreener: DexScreenerPriceProvider,
    private jupiter: JupiterPriceProvider,
  ) {}

  seedPrice(_mint: string, _priceSOL: number) {
    // kept for API compatibility
  }

  async getPrice(mint: string): Promise<number | null> {
    const r = await this.getPriceWithSource(mint);
    return r?.price ?? null;
  }

  async getPriceWithSource(mint: string): Promise<PriceResult | null> {
    const cp = await this.crypull.getPrice(mint);
    if (cp !== null && cp > 0) return { price: cp, source: "crypull" };

    const ds = await this.dexscreener.getPrice(mint);
    if (ds !== null && ds > 0) return { price: ds, source: "dexscreener" };

    const jp = await this.jupiter.getPrice(mint);
    if (jp !== null && jp > 0) return { price: jp, source: "jupiter" };

    return null;
  }
}
