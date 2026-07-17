import { CONFIG } from "../config";
import type { NewTokenEvent, FilterResult } from "../pipeline/types";

const minMarketCapSol = CONFIG.positionSizeSol * 5;
const minInitialBuyTokens = 10_000_000;
const maxPoolFeeRate = 0.05;
const allowedPools = new Set(["pump"]);

export function initialFilter(event: NewTokenEvent): FilterResult {
  if (!/pump$/i.test(event.mint)) {
    return { passed: false, reason: `mint "${event.mint}" does not end with PUMP` };
  }

  if (event.pool && !allowedPools.has(event.pool)) {
    return { passed: false, reason: `pool "${event.pool}" not in allowed set` };
  }

  if (event.marketCapQuote != null) {
    if (event.marketCapQuote < minMarketCapSol) {
      return { passed: false, reason: `marketCap ${event.marketCapQuote} < ${minMarketCapSol} SOL` };
    }
  }

  if (event.initialBuy != null && event.initialBuy < minInitialBuyTokens) {
    return { passed: false, reason: `initialBuy ${event.initialBuy} < ${minInitialBuyTokens}` };
  }

  if (event.poolFeeRate != null && event.poolFeeRate > maxPoolFeeRate) {
    return { passed: false, reason: `poolFeeRate ${event.poolFeeRate} > ${maxPoolFeeRate}` };
  }

  if (event.burnedLiquidityPct != null && event.burnedLiquidityPct < 80) {
    return { passed: false, reason: `burnedLiquidity ${event.burnedLiquidityPct}% < 80%` };
  }

  return { passed: true };
}
