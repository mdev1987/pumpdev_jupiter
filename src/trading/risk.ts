import { CONFIG } from "../config";

export function allowBuy(balance: number, amount: number): boolean {
  if (amount > CONFIG.maxPositionSol) return false;
  if (balance < amount) return false;
  return true;
}

export interface ExitSignal {
  shouldExit: boolean;
  reason: string;
}

export function evaluateExit(
  entryPrice: number,
  currentPrice: number,
  peakPrice: number,
  openedAt: number,
): ExitSignal {
  const pnl = (currentPrice - entryPrice) / entryPrice;
  const holdingMs = Date.now() - openedAt;

  if (pnl <= CONFIG.stopLossPct) {
    return { shouldExit: true, reason: "stop_loss" };
  }

  if (pnl >= CONFIG.takeProfitPct) {
    return { shouldExit: true, reason: "take_profit" };
  }

  if (
    CONFIG.trailingActivationPct > 0 &&
    pnl >= CONFIG.trailingActivationPct
  ) {
    const trailDrop = (peakPrice - currentPrice) / peakPrice;
    if (trailDrop >= CONFIG.trailingStopPct) {
      return { shouldExit: true, reason: "trailing_stop" };
    }
  }

  if (CONFIG.maxTtlSecs > 0 && holdingMs >= CONFIG.maxTtlSecs * 1000) {
    return { shouldExit: true, reason: "ttl_expired" };
  }

  return { shouldExit: false, reason: "" };
}
