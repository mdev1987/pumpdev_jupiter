export interface PumpCoinsRugAnalysis {
  asOf: string;
  mint: string;
  verdict: "PASS" | "WARN" | "FAIL";
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  fdv: number;
  priceChange24h: number;
  pairAgeHours: number;
  dex: string;
  checks: {
    established: boolean;
    mintRevoked: boolean;
    freezeRevoked: boolean;
    lpLockedPct: number;
    lpLocked: boolean;
    rugScore: number;
    rugScoreOk: boolean;
    top10Pct: number;
    top10Ok: boolean;
    liquidityUsd: number;
    liquidityOk: boolean;
    hasPool: boolean;
    flags: string[];
    thresholds: {
      lpLockedMinPct: number;
      maxTop10Pct: number;
      minLiquidityUsd: number;
      maxRugScore: number;
    };
  };
  flags: string[];
  buyUrl: string;
}

export interface RugInfo {
  source: "pumpcoins" | "signal";
  verdict?: "PASS" | "WARN" | "FAIL";
  score: number;
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  lpLockedPct?: number;
  lpLocked?: boolean;
  rugScoreOk?: boolean;
  top10Pct?: number;
  top10Ok?: boolean;
  established?: boolean;
  liquidityUsd?: number;
  liquidityOk?: boolean;
  hasPool?: boolean;
  pairAgeHours?: number;
  volume24h?: number;
  fdv?: number;
  priceChange24h?: number;
  priceUsd?: number;
  dex?: string;
  flags?: string[];
}

const BASE_URL = "https://pumpcoins.net/api";

const rugCache = new Map<string, { result: PumpCoinsRugAnalysis; at: number }>();
const CACHE_TTL_MS = 300_000;

export async function getRugAnalysis(
  mint: string,
): Promise<PumpCoinsRugAnalysis> {
  const cached = rugCache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }
  const res = await fetch(
    `${BASE_URL}/check?mint=${encodeURIComponent(mint)}`,
    {
      headers: {
        Accept: "application/json",
        Referer: `https://pumpcoins.net/rug-check?mint=${mint}`,
      },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!res.ok) {
    throw new Error(`PumpCoins API ${res.status}: ${await res.text()}`);
  }

  const result = await res.json() as PumpCoinsRugAnalysis;
  if (!result || typeof result !== "object") {
    throw new Error(`PumpCoins API returned non-object: ${JSON.stringify(result).slice(0, 200)}`);
  }
  rugCache.set(mint, { result, at: Date.now() });
  return result;
}

function n(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v !== "number") return undefined;
  if (!Number.isFinite(v)) return undefined;
  return v;
}

export function buildRugFromApi(api: PumpCoinsRugAnalysis): RugInfo {
  const c = api.checks;
  if (!c) {
    return {
      source: "pumpcoins",
      score: 10,
      flags: api.flags?.length ? api.flags : undefined,
    };
  }
  return {
    source: "pumpcoins",
    verdict: api.verdict,
    score: c.rugScore,
    mintRevoked: c.mintRevoked,
    freezeRevoked: c.freezeRevoked,
    lpLockedPct: n(c.lpLockedPct),
    lpLocked: c.lpLocked,
    rugScoreOk: c.rugScoreOk,
    top10Pct: n(c.top10Pct),
    top10Ok: c.top10Ok,
    established: c.established,
    liquidityUsd: n(api.liquidityUsd),
    liquidityOk: c.liquidityOk,
    hasPool: c.hasPool,
    pairAgeHours: n(api.pairAgeHours),
    volume24h: n(api.volume24h),
    fdv: n(api.fdv),
    priceChange24h: n(api.priceChange24h),
    priceUsd: n(api.priceUsd),
    dex: api.dex,
    flags: api.flags?.length ? api.flags : undefined,
  };
}
