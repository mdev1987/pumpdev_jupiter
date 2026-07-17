import { Bot } from "grammy";
import { convert } from "telegram-markdown-v2";
import { CONFIG } from "../config";

/* -------------------------------------------------------------------------- */
/*                                   Bot                                      */
/* -------------------------------------------------------------------------- */

let bot: Bot | null = null;

export function initTelegramBot(): void {
  if (bot) return;
  if (!CONFIG.telegramBotToken) {
    console.warn("[TelegramBot] No token configured");
    return;
  }
  bot = new Bot(CONFIG.telegramBotToken);
  console.log("[TelegramBot] Initialized");
}

export function shutdownTelegramBot(): void {
  bot = null;
}

/* -------------------------------------------------------------------------- */
/*                               Send Message                                 */
/* -------------------------------------------------------------------------- */

export function sendTelegram(text: string): void {
  if (!bot || !CONFIG.telegramChatId) return;
  try {
    const converted = convert(text);
    bot.api.sendMessage(CONFIG.telegramChatId, converted, {
      parse_mode: "MarkdownV2",
    }).catch((err) => {
      console.error("[TelegramBot] Failed to send msg:", err);
    });
  } catch (err) {
    console.error("[TelegramBot] Failed to convert msg:", err);
  }
}

/* -------------------------------------------------------------------------- */
/*                               Formatters                                   */
/* -------------------------------------------------------------------------- */

export function fmtPrice(price: number, currency?: "SOL" | "USD"): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  const s = price >= 1
    ? price.toFixed(4)
    : price >= 0.001
      ? price.toFixed(6)
      : price >= 0.000001
        ? price.toFixed(9)
        : price.toFixed(12);
  if (currency === "SOL") return `${s} SOL`;
  return `$${s}`;
}

function fmtBalance(balance: number, currency: "SOL" | "USD"): string {
  if (currency === "SOL") return `${balance.toFixed(4)} SOL`;
  return `$${balance.toFixed(2)}`;
}

export function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function fmtMcap(mcap: number): string {
  if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(2)}B`;
  if (mcap >= 1e6) return `$${(mcap / 1e6).toFixed(2)}M`;
  if (mcap >= 1e3) return `$${(mcap / 1e3).toFixed(2)}K`;
  return `$${mcap.toFixed(2)}`;
}

export function fmtDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function fmtRiskLevel(level?: string): string {
  if (!level) return "";
  const lower = level.toLowerCase();
  if (lower.includes("low")) return "🟢 Low";
  if (lower.includes("medium") || lower.includes("mid")) return "🟡 Medium";
  if (lower.includes("high")) return "🔴 High";
  return `⚪ ${level}`;
}

/* -------------------------------------------------------------------------- */
/*                               Notifications                                */
/* -------------------------------------------------------------------------- */

export function notifyBuyOpened(
  tokenName: string,
  sizeSol: number,
  balance: number,
  balanceCurrency: "SOL" | "USD",
  mcap?: number,
  dex?: string,
  openPositions?: number,
  totalPositions?: number,
  winRate?: number,
  priceCurrency?: "SOL" | "USD",
  entryPriceSOL?: number,
  riskLevel?: string,
  riskScore?: number,
  securityFlags?: { ownershipRenounced?: boolean; top10HoldingsBelow30Pct?: boolean; stopMint?: boolean; noBlacklist?: boolean },
  priceSource?: string,
  rug?: import("../utils/rug_check").RugInfo,
): void {
  const lines = [
    `🟢 **Position Opened**`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🔖 Token: \`${tokenName}\``,
    `💰 Size: \`${sizeSol} SOL\``,
  ];

  if (entryPriceSOL !== undefined) lines.push(`💵 Entry: \`${fmtPrice(entryPriceSOL, "SOL")}\``);
  lines.push(`💳 Balance: \`${fmtBalance(balance, balanceCurrency)}\``);

  if (mcap) lines.push(`📊 MCap: \`${fmtMcap(mcap)}\``);
  lines.push(`🏛 Dex: \`${dex ?? "—"}\``);

  if (rug?.source === "pumpcoins") {
    const v = rug.verdict;
    const badge = v === "PASS" ? "🟢" : v === "WARN" ? "🟡" : "🔴";
    lines.push(`🛡 Rug: ${badge} \`${v ?? "?"}\` (score: \`${rug.score}\`)`);
    if (rug.established !== undefined) {
      const est = rug.established ? "✅" : "❌";
      const mintR = rug.mintRevoked ? "✅" : "❌";
      const freezeR = rug.freezeRevoked ? "✅" : "❌";
      lines.push(`🔒 Established: ${est} · Mint: ${mintR} · Freeze: ${freezeR}`);
    }
    const lpLine: string[] = [];
    if (rug.lpLockedPct !== undefined) lpLine.push(`LP: ${rug.lpLockedPct.toFixed(1)}%`);
    if (rug.top10Pct !== undefined) lpLine.push(`Top10: ${rug.top10Pct.toFixed(1)}%`);
    if (rug.pairAgeHours !== undefined) lpLine.push(`Age: ${rug.pairAgeHours.toFixed(0)}h`);
    if (lpLine.length) lines.push(`🔐 \`${lpLine.join(" · ")}\``);
    if (rug.priceUsd !== undefined) {
      const liq = rug.liquidityUsd !== undefined ? ` · Liq: $${fmtShort(rug.liquidityUsd)}` : "";
      const vol = rug.volume24h !== undefined ? ` · Vol: $${fmtShort(rug.volume24h)}` : "";
      const fdv = rug.fdv !== undefined ? ` · FDV: $${fmtShort(rug.fdv)}` : "";
      lines.push(`📊 $${rug.priceUsd}${liq}${vol}${fdv}`);
    }
    if (rug.flags?.length) lines.push(`🚩 Flags: \`${rug.flags.join(", ")}\``);
  } else if (rug?.source === "signal") {
    const badge = rug.score <= 1 ? "🟢" : rug.score <= 3 ? "🟡" : "🔴";
    lines.push(`🛡 Risk: ${badge} \`Signal\` (score: \`${rug.score}\`)`);
    const parts: string[] = [];
    if (rug.mintRevoked !== undefined) parts.push(`Mint: ${rug.mintRevoked ? "✅" : "❌"}`);
    if (rug.freezeRevoked !== undefined) parts.push(`Freeze: ${rug.freezeRevoked ? "✅" : "❌"}`);
    if (parts.length) lines.push(`🔒 ${parts.join(" · ")}`);
  } else {
    if (riskLevel) {
      const score = riskScore !== undefined ? ` (${riskScore})` : "";
      lines.push(`🛡 Risk: \`${fmtRiskLevel(riskLevel)}${score}\``);
    }
    if (securityFlags) {
      const f = (ok: boolean | undefined, label: string) => `🔍 ${label}: ${ok ? "✅" : "❌"}`;
      lines.push(
        f(securityFlags.ownershipRenounced, "Ownership renounced"),
        f(securityFlags.top10HoldingsBelow30Pct, "Top10 <30%"),
        f(securityFlags.stopMint, "Mint stopped"),
        f(securityFlags.noBlacklist, "No blacklist"),
      );
    }
  }

  if (priceSource) lines.push(`📡 Price: \`${priceSource}\``);

  if (openPositions !== undefined) {
    const wr = winRate !== undefined ? ` · Win rate: \`${(winRate * 100).toFixed(0)}%\`` : "";
    lines.push(`📊 Positions: \`${openPositions}/${totalPositions ?? openPositions}\`${wr}`);
  }

  sendTelegram(lines.join("\n"));
}

function fmtShort(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toFixed(2);
}

export function notifyBuyRejected(
  tokenName: string,
  reason: string,
  details?: string,
): void {
  const lines = [
    `⛔ **Buy Rejected**`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🔖 Token: \`${tokenName}\``,
    `📋 Reason: \`${reason}\``,
  ];
  if (details) lines.push(`💡 ${details}`);

  sendTelegram(lines.join("\n"));
}

export function notifyTradeClosed(
  tokenName: string,
  pnl: number,
  entryPrice: number,
  exitPrice: number,
  peakPrice: number,
  sizeSol: number,
  balance: number,
  balanceCurrency: "SOL" | "USD",
  reason: string,
  durationMs: number,
  openPositions?: number,
  totalPositions?: number,
  winRate?: number,
  priceCurrency?: "SOL" | "USD",
  priceSource?: string,
  dex?: string,
): void {
  const label = !Number.isFinite(pnl) ? "⚪" : pnl >= 0 ? "🟢" : "🔴";

  const lines = [
    `${label} **Trade Closed**`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🔖 Token: \`${tokenName}\``,
    `🏛 Dex: \`${dex ?? "—"}\``,
    `📈 PnL: **${fmtPct(pnl)}**`,
    `💵 Entry: \`${fmtPrice(entryPrice, priceCurrency)}\``,
    `💵 Exit: \`${fmtPrice(exitPrice, priceCurrency)}\``,
    `📊 Peak: \`${fmtPrice(peakPrice, priceCurrency)}\``,
    `💰 Size: \`${sizeSol} SOL\``,
    `💳 Balance: \`${fmtBalance(balance, balanceCurrency)}\``,
    `📋 Reason: \`${reason}\``,
    `⏱ Duration: \`${fmtDuration(durationMs)}\``,
  ];

  if (priceSource) lines.push(`📡 Price: \`${priceSource}\``);

  if (openPositions !== undefined) {
    const wr = winRate !== undefined ? ` · Win rate: \`${(winRate * 100).toFixed(0)}%\`` : "";
    lines.push(`📊 Positions: \`${openPositions}/${totalPositions ?? openPositions}\`${wr}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━`);

  sendTelegram(lines.join("\n"));
}

export function notifyExitTask(
  label: string,
  tokenName: string,
  isSuccess: boolean,
  priceUsd?: number,
  errorMessage?: string,
  txHash?: string,
): void {
  const emoji = isSuccess ? "🟢" : "🔴";

  const lines = [
    `${emoji} **${label} ${isSuccess ? "Success" : "Failed"}**`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🔖 Token: \`${tokenName}\``,
  ];

  if (priceUsd) lines.push(`💵 Price: \`$${priceUsd}\``);
  if (!isSuccess && errorMessage) lines.push(`❌ Error: \`${errorMessage}\``);
  if (isSuccess && txHash) lines.push(`🔗 Tx: \`${txHash.slice(0, 16)}…\``);

  sendTelegram(lines.join("\n"));
}

export function sendTradeReport(
  total: number,
  winRate: number,
  avgWin: number,
  avgLoss: number,
  profitFactor: number,
  expectancy: number,
  medianDurationMs: number,
  best: { tokenName: string; pnl: number },
  worst: { tokenName: string; pnl: number },
  exitTypes: Record<string, number>,
  avgMcap?: number,
  openPositions?: number,
  queuedSignals?: number,
): void {
  const lines: string[] = [
    `📊 **Trade Report \\(last ${total}\\)**`,
    `━━━━━━━━━━━━━━━━━━━`,
    `Trades: \`${total}\``,
    `Win rate: \`${(winRate * 100).toFixed(0)}%\``,
    `Avg winner: \`${fmtPct(avgWin)}\``,
    `Avg loser: \`${fmtPct(avgLoss)}\``,
    `Profit factor: \`${profitFactor.toFixed(2)}\``,
    `Expectancy: \`${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}R\``,
    `Median hold: \`${fmtDuration(medianDurationMs)}\``,
    ``,
    `Best: \`${best.tokenName}\` ${fmtPct(best.pnl)}`,
    `Worst: \`${worst.tokenName}\` ${fmtPct(worst.pnl)}`,
    ``,
    ...Object.entries(exitTypes)
      .sort(([, a], [, b]) => b - a)
      .map(
        ([label, count]) =>
          `${label}: \`${((count / total) * 100).toFixed(0)}%\``,
      ),
  ];

  if (avgMcap && avgMcap > 0) {
    lines.push(`Avg MCap: \`${fmtMcap(avgMcap)}\``);
  }
  if (openPositions !== undefined) {
    lines.push(`Open: \`${openPositions}\``);
  }
  if (queuedSignals !== undefined) {
    lines.push(`Queued: \`${queuedSignals}\``);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━`);

  sendTelegram(lines.join("\n"));
}
