import { CONFIG } from "../config";
import type { DexScreenerPool } from "../trading/price_provider";
import type { PumpCoinsRugAnalysis } from "../utils/rug_check";

export interface ScoreResult {
  score: number;
  action: "buy" | "watch" | "reject";
  breakdown: Record<string, number>;
  reason?: string;
}

export interface WalletInfo {
  amount: number;
  winRate?: number;
}

export function scoreSignal(params: {
  wallets: WalletInfo[];
  walletCount: number;
  totalInvested: number;
  dexPool?: DexScreenerPool;
  rugAnalysis?: PumpCoinsRugAnalysis;
  mcap: number;
}): ScoreResult {
  const { wallets, walletCount, totalInvested, dexPool, rugAnalysis, mcap } = params;
  const breakdown: Record<string, number> = {};

  // ── 1. Hard Safety Gate ──
  const hardGate = checkHardGates(rugAnalysis);
  if (hardGate) {
    return { score: 0, action: "reject", breakdown, reason: hardGate };
  }

  let score = 0;

  // ── 2. Security Score (max ~50) ──
  let security = 0;
  if (rugAnalysis?.verdict === "PASS") {
    security += 20;
  } else if (rugAnalysis?.verdict === "WARN" && (rugAnalysis.checks?.rugScore ?? 10) <= 5) {
    security += 10;
  }

  if (rugAnalysis?.checks) {
    const c = rugAnalysis.checks;
    if (c.lpLockedPct != null && c.lpLockedPct >= 90) security += 10;
    if (c.mintRevoked) security += 10;
    if (c.freezeRevoked) security += 10;
    if (c.established) security += 10;
  }
  breakdown.security = security;
  score += security;

  // ── 3. Holder Distribution Score (max +15 / min -25) ──
  let holders = 0;
  const top10 = rugAnalysis?.checks?.top10Pct;
  if (top10 != null) {
    if (top10 < 20) holders += 15;
    else if (top10 < 40) holders += 5;
    else if (top10 < 60) holders -= 10;
    else holders -= 25;
  }
  breakdown.holders = holders;
  score += holders;

  // ── 4. Wallet / Cluster Score (max ~30 / min ~-45) ──
  let walletScore = 0;

  if (walletCount >= 3 && walletCount <= 8) walletScore += 10;
  else if (walletCount < 3) walletScore -= 10;
  else if (walletCount > 8) walletScore -= 5;

  if (totalInvested >= 5 && totalInvested <= 15) walletScore += 10;
  else if (totalInvested < 3) walletScore -= 5;
  else if (totalInvested > 50) walletScore -= 10;

  const amounts = wallets.map((w) => w.amount).filter((a) => a > 0);
  if (amounts.length > 0) {
    const total = amounts.reduce((a, b) => a + b, 0);
    const maxAmt = Math.max(...amounts);
    const maxShare = maxAmt / total;
    if (maxShare < 0.2) walletScore += 10;
    else if (maxShare < 0.4) walletScore += 0;
    else if (maxShare < 0.6) walletScore -= 5;
    else walletScore -= 15;
  }

  breakdown.wallets = Math.max(-30, Math.min(30, walletScore));
  score += breakdown.wallets;

  // ── 5. Momentum Score (max ~35 / min ~-25) ──
  let momentum = 0;

  if (dexPool) {
    const liq = dexPool.liquidity?.usd;
    const volM5 = dexPool.volume?.m5;
    const volH1 = dexPool.volume?.h1;

    if (liq && liq > 0) {
      if (volM5 && volM5 > 0) {
        const vlr = volM5 / liq;
        if (vlr > 5) momentum += 20;
        else if (vlr >= 2) momentum += 10;
        else if (vlr < 1) momentum -= 10;
      } else if (volH1 && volH1 > 0) {
        const vlr = volH1 / liq;
        if (vlr > 5) momentum += 20;
        else if (vlr >= 2) momentum += 10;
      }
    }

    const txnsM5 = dexPool.txns?.m5;
    const txnsH1 = dexPool.txns?.h1;
    if (txnsM5) {
      const bsRatio = txnsM5.buys / Math.max(txnsM5.sells, 1);
      if (bsRatio > 3) momentum += 15;
      else if (bsRatio >= 1) momentum += 5;
      else momentum -= 15;
    } else if (txnsH1) {
      const bsRatio = txnsH1.buys / Math.max(txnsH1.sells, 1);
      if (bsRatio > 3) momentum += 15;
      else if (bsRatio >= 1) momentum += 5;
    }
  }

  breakdown.momentum = momentum;
  score += momentum;

  // ── 6. MC Score (max +10 / min -15) ──
  let mcScore = 0;
  if (mcap > 0) {
    if (mcap >= 20000 && mcap <= 100000) mcScore += 10;
    else if (mcap < 5000) mcScore -= 10;
    else if (mcap > 200000) mcScore -= 15;
  }
  breakdown.mcap = mcScore;
  score += mcScore;

  // ── Decision ──
  if (score >= CONFIG.cabalScoreBuy) {
    return { score, action: "buy", breakdown };
  }
  if (score >= CONFIG.cabalScoreWatch) {
    return { score, action: "watch", breakdown, reason: `Score ${score} in watch range (${CONFIG.cabalScoreWatch}-${CONFIG.cabalScoreBuy - 1})` };
  }
  return { score, action: "reject", breakdown, reason: `Score ${score} < ${CONFIG.cabalScoreWatch}` };
}

function checkHardGates(rug?: PumpCoinsRugAnalysis): string | null {
  if (!rug?.checks) return null;

  if (CONFIG.cabalFailReject && rug.verdict === "FAIL") {
    return `RugCheck FAIL (score: ${rug.checks.rugScore})`;
  }

  const c = rug.checks;

  if (!c.mintRevoked) return "Mint authority not revoked";
  if (!c.freezeRevoked) return "Freeze authority not revoked";

  // Only enforce LP/liquidity gates when a real pool exists (bonding curve graduated)
  if (c.hasPool) {
    if (!c.lpLocked && c.liquidityUsd > 5000) return "LP unlocked with liquidity";
    if (c.liquidityUsd < 5000) return `Liquidity $${c.liquidityUsd} < $5000 (has pool)`;
  }

  return null;
}
