import { Subject, interval } from "rxjs";

import { CONFIG } from "./config";
import { PriceSource } from "./strategy/types";

import { initTelegramBot, shutdownTelegramBot } from "./telegram/telegram_bot";
import { startTelegramListener, stopTelegramListener } from "./telegram/telegram_client";
import { initSignalQueue, stopSignalQueue, enqueueSignal, signalQueued$ } from "./telegram/telegram_signal_queue";

import { PaperWallet } from "./trading/paper_wallet";
import { PositionManager } from "./trading/position";
import { PaperExecutor } from "./trading/paper_executor";
import { TradeStore } from "./trading/trade_store";
import { PumpDevPriceProvider, JupiterPriceProvider, PriceRouter } from "./trading/price_provider";
import { getSolUsdRate } from "./utils/sol_usd";

import { startPumpDevListener, stopPumpDevListener } from "./pumpdev/listener";

import { PositionEngine } from "./strategy/engine";
import { registerStrategies, exitDecision$, clearPendingExit } from "./strategy/scanner";
import { addPosition, removePosition, patchPosition, getPositions } from "./strategy/store";
import { StopLossStrategy } from "./strategy/exit-strategies/stop-loss";
import { TrailingStopStrategy } from "./strategy/exit-strategies/trailing-stop";
import { TtlStrategy } from "./strategy/exit-strategies/ttl";
import { PartialTakeProfitStrategy } from "./strategy/exit-strategies/partial-tp";
import { ExitAction } from "./strategy/exit-strategies/types";
import type { ExitDecision } from "./strategy/exit-strategies/types";

const wallet = new PaperWallet(CONFIG.paperBalanceSol);
const positions = new PositionManager();
const store = new TradeStore(CONFIG.dbPath);

const pumpDevPrices = new PumpDevPriceProvider();
const jupiterPrices = new JupiterPriceProvider();
const prices = new PriceRouter(pumpDevPrices, jupiterPrices);

const executor = new PaperExecutor(wallet, positions, store, prices);

// ---------------------------------------------------------------------------
// Strategy system
// ---------------------------------------------------------------------------

const priceUpdate$ = new Subject<import("./strategy/types").PriceInfo>();

const engine = new PositionEngine(priceUpdate$, CONFIG.positionScanIntervalMs);

registerStrategies(
  new StopLossStrategy(CONFIG.stopLossPct < 0, CONFIG.stopLossPct),
  new TrailingStopStrategy(CONFIG.trailingActivationPct, CONFIG.trailingStopPct),
  new TtlStrategy(CONFIG.baseTtlSecs, CONFIG.maxTtlSecs, CONFIG.ttlRenewThresholdPct),
  new PartialTakeProfitStrategy(CONFIG.partialTpTiers.length > 0, CONFIG.partialTpTiers),
);

async function handleExitDecision(d: ExitDecision): Promise<void> {
  const { position, action, reason, percentage, patch } = d;

  switch (action) {
    case ExitAction.Close:
      await executor.sell(position.token, reason);
      removePosition(position.pair, position.currentPrice, reason);
      clearPendingExit(position.id);
      break;

    case ExitAction.PartialSell: {
      const pnl = (position.currentPrice - position.entryPrice) / position.entryPrice;
      const sellAmount = position.sizeSol * (percentage ?? 1);
      const value = sellAmount * (1 + pnl);
      wallet.deposit(value);
      if (patch) patchPosition(position.id, patch);
      clearPendingExit(position.id);
      break;
    }

    case ExitAction.Renew:
      if (patch) patchPosition(position.id, patch);
      clearPendingExit(position.id);
      break;

    default:
      break;
  }
}

exitDecision$.subscribe(handleExitDecision);

// ---------------------------------------------------------------------------
// Price feed → strategy engine
// ---------------------------------------------------------------------------

interval(CONFIG.pricePollIntervalMs).subscribe(async () => {
  for (const pos of getStrategyPositions()) {
    try {
      const priceSOL = await prices.getPrice(pos.token);
      if (!priceSOL || priceSOL <= 0) continue;
      priceUpdate$.next({
        token: pos.token,
        pair: pos.pair,
        priceUsd: priceSOL,
        source: PriceSource.PUMPAPI,
        timestamp: Date.now(),
        currency: "SOL",
      });
    } catch (err) {
      console.error(`[PriceFeed] Error for ${pos.tokenName}:`, err);
    }
  }
});

function getStrategyPositions() {
  return [...getPositions().values()];
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

initTelegramBot();

if (CONFIG.telegramChannelUserName) {
  startTelegramListener().catch((err) => console.error("[Main] Telegram listener error:", err));
  initSignalQueue(CONFIG.telegramChannelUserName);
}

signalQueued$.subscribe(async (queued) => {
  const s = queued.signal;
  const bought = await executor.buy({
    token: s.Token ?? "UNKNOWN",
    ca: s.CA ?? "",
    priceUSD: s.initPriceUSD ?? 0,
    dex: s.dex,
    mcap: s.marketCapUSD,
    riskLevel: s.security?.riskLevel,
    riskScore: s.security?.score,
    securityFlags: s.security ? {
      ownershipRenounced: s.security.ownershipRenounced,
      top10HoldingsBelow30Pct: s.security.top10HoldingsBelow30Pct,
      stopMint: s.security.stopMint,
      noBlacklist: s.security.noBlacklist,
    } : undefined,
  });

  if (bought && s.CA) {
    const solUsd = await getSolUsdRate();
    const entryPriceSOL = s.initPriceUSD ? s.initPriceUSD / solUsd : 0;
    addPosition(
      s.CA,
      s.CA,
      s.Token ?? "UNKNOWN",
      entryPriceSOL,
      CONFIG.positionSizeSol,
      { marketCapUSD: s.marketCapUSD, dex: s.dex },
      "SOL",
    );
  }

  if (!bought) {
    enqueueSignal(queued);
  }
});

// ---------------------------------------------------------------------------
// PumpDev + Engine start
// ---------------------------------------------------------------------------

startPumpDevListener(positions, pumpDevPrices);
engine.start();

console.log(`Bot started — ${wallet.getBalance()} SOL, ${positions.count()} positions`);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("\nShutting down...");
  engine.stop();
  stopPumpDevListener();
  stopSignalQueue();
  await stopTelegramListener().catch(() => {});
  shutdownTelegramBot();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
