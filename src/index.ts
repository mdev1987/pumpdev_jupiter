import { Subject, interval } from "rxjs";
import { CONFIG } from "./config";
import { PaperWallet } from "./trading/paper_wallet";
import { PositionManager } from "./trading/position";
import { PaperExecutor } from "./trading/paper_executor";
import { TradeStore } from "./trading/trade_store";
import { CrypullPriceProvider, JupiterPriceProvider, DexScreenerPriceProvider, PriceRouter } from "./trading/price_provider";
import { initTelegramBot, shutdownTelegramBot } from "./telegram/telegram_bot";
import { startCabalSpy, stopCabalSpy } from "./cabalspy/listener";
import { PositionEngine } from "./strategy/engine";
import { registerStrategies, exitDecision$, clearPendingExit } from "./strategy/scanner";
import { addPosition, getPositions, removePosition } from "./strategy/store";
import { StopLossStrategy } from "./strategy/exit-strategies/stop-loss";
import { TrailingStopStrategy } from "./strategy/exit-strategies/trailing-stop";
import { PartialTakeProfitStrategy } from "./strategy/exit-strategies/partial-tp";
import { TtlStrategy } from "./strategy/exit-strategies/ttl";
import { PriceSource } from "./strategy/types";
import type { PriceInfo } from "./strategy/types";
import { getSolUsdRate } from "./utils/sol_usd";
import { log } from "./utils/logger";

const wallet = new PaperWallet(CONFIG.paperBalanceSol);
const store = new TradeStore(CONFIG.dbPath);
const priceRouter = new PriceRouter(new CrypullPriceProvider(), new DexScreenerPriceProvider(), new JupiterPriceProvider());
const executor = new PaperExecutor(wallet, new PositionManager(), store, priceRouter);

// ---------------------------------------------------------------------------
// Strategy Engine
// ---------------------------------------------------------------------------

const price$ = new Subject<PriceInfo>();
const engine = new PositionEngine(price$);

registerStrategies(
  new StopLossStrategy(true, CONFIG.stopLossPct),
  new TrailingStopStrategy(CONFIG.trailingActivationPct, CONFIG.trailingStopPct),
  new PartialTakeProfitStrategy(true, CONFIG.partialTpTiers),
  new TtlStrategy(CONFIG.baseTtlSecs, CONFIG.maxTtlSecs, CONFIG.ttlRenewThresholdPct),
);

exitDecision$.subscribe(async (decision) => {
  const ca = decision.position.pair;
  await executor.sell(ca, decision.reason);
  removePosition(ca);
  clearPendingExit(decision.position.id);
});

// ---------------------------------------------------------------------------
// Batch Price Polling for Strategy Engine (DexScreener, every 200ms)
// ---------------------------------------------------------------------------

let pricePollTimer: ReturnType<typeof setInterval> | null = null;

async function batchPollPrices() {
  const positions = getPositions();
  if (positions.size === 0) return;

  try {
    const solUsd = await getSolUsdRate();
    const addrs = [...positions.keys()];
    const results = await priceRouter.getPricesBatch(addrs);

    const now = Date.now();
    for (const [ca, { price }] of results) {
      if (price > 0) {
        executor.updatePrice(ca, price);
        price$.next({
          token: ca,
          pair: ca,
          priceUsd: price * solUsd,
          source: PriceSource.UNKNOWN,
          timestamp: now,
          currency: "USD" as const,
        });
      }
    }
  } catch {}
}

/*
// ---------------------------------------------------------------------------
// Telegram Ave Monitor Signals
// ---------------------------------------------------------------------------

telegramAveMonitorSignal$.subscribe(async (signal) => {
  if (signal.signalType === "pump") {
    if (hasPosition(signal.ca)) {
      await executor.sell(signal.ca, "ave_sell");
      removePosition(signal.ca);
    }
    return;
  }

  if (hasPosition(signal.ca)) return;

  let rugInfo = undefined;
  try {
    const apiResult = await getRugAnalysis(signal.ca);
    rugInfo = buildRugFromApi(apiResult);
    const badge = rugInfo.verdict === "PASS" ? "🟢" : rugInfo.verdict === "WARN" ? "🟡" : "🔴";
    sendTelegram(
      `🛡 **RugCheck — ${signal.token}**\n━━━━━━━━━━━━━━━━━━━\n🔖 Token: \`${signal.token}\`\n🔗 CA: \`${signal.ca}\`\n📊 MCap: ${signal.mcap ? `$${(signal.mcap / 1000).toFixed(1)}K` : "?"}\n${badge} Verdict: ${rugInfo.verdict ?? "?"} · Score: ${rugInfo.score}` +
      (rugInfo.mintRevoked !== undefined ? `\n🔒 Mint: ${rugInfo.mintRevoked ? "✅" : "❌"} · Freeze: ${rugInfo.freezeRevoked ? "✅" : "❌"}` : "") +
      (rugInfo.lpLockedPct != null ? `\n🔐 LP: ${rugInfo.lpLockedPct.toFixed(1)}%` : "") +
      (rugInfo.flags?.length ? `\n🚩 Flags: ${rugInfo.flags.join(", ")}` : ""),
    );
  } catch (err) {
    sendTelegram(`⚠️ **RugCheck Failed — ${signal.token}**\n\`${signal.ca}\`\n❌ ${err}`);
  }

  const bought = await executor.buy({
    token: signal.token,
    ca: signal.ca,
    priceUSD: 0,
    dex: "pump",
    mcap: signal.mcap,
    source: "ave.ai",
    rug: rugInfo,
  });
  if (bought) {
    addPosition(signal.ca, signal.ca, signal.token, 0, CONFIG.positionSizeSol, {
      marketCapUSD: signal.mcap,
      dex: "pump",
    });
  }
});
*/

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

initTelegramBot();
startCabalSpy(executor, {
  onBuy: (ca, name, entryPriceUSD, sizeSol) => {
    addPosition(ca, ca, name, entryPriceUSD, sizeSol, { dex: "pump" });
  },
  onSell: (ca) => {
    removePosition(ca);
  },
});
// startTelegramListener().catch((err: Error) => console.warn("[Telegram] Skipped:", err.message));
engine.start();
pricePollTimer = setInterval(batchPollPrices, CONFIG.pricePollIntervalMs);
batchPollPrices();

log.success("bot", `Started — ${wallet.getBalance()} SOL · engine=${engine.constructor.name}`);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  log.info("bot", "Shutting down...");
  stopCabalSpy();
  // await stopTelegramListener().catch(() => {});
  shutdownTelegramBot();
  if (pricePollTimer) clearInterval(pricePollTimer);
  engine.stop();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
