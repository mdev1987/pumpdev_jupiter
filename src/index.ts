import { Subject, interval } from "rxjs";

import { CONFIG } from "./config";
import { PriceSource } from "./strategy/types";

import { PaperWallet } from "./trading/paper_wallet";
import { PositionManager } from "./trading/position";
import { PaperExecutor } from "./trading/paper_executor";
import { TradeStore } from "./trading/trade_store";
import { PumpDevPriceProvider, JupiterPriceProvider, PriceRouter } from "./trading/price_provider";
import { getSolUsdRate } from "./utils/sol_usd";
import { initTelegramBot, shutdownTelegramBot } from "./telegram/telegram_bot";

import { startPumpDevListener, stopPumpDevListener } from "./pumpdev/listener";
import { startPumpAPIListener, stopPumpAPIListener } from "./pumpapi/listener";

import { PositionEngine } from "./strategy/engine";
import { registerStrategies, exitDecision$, clearPendingExit } from "./strategy/scanner";
import { addPosition, removePosition, patchPosition, getPositions } from "./strategy/store";
import { StopLossStrategy } from "./strategy/exit-strategies/stop-loss";
import { TrailingStopStrategy } from "./strategy/exit-strategies/trailing-stop";
import { TtlStrategy } from "./strategy/exit-strategies/ttl";
import { PartialTakeProfitStrategy } from "./strategy/exit-strategies/partial-tp";
import { ExitAction } from "./strategy/exit-strategies/types";
import type { ExitDecision } from "./strategy/exit-strategies/types";

import { startPipeline, stopPipeline, setExecuteHandler } from "./pipeline/pipeline";
import type { ScoredToken } from "./pipeline/pipeline";

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
// Pipeline — new token processing
// ---------------------------------------------------------------------------

setExecuteHandler(async (scored: ScoredToken) => {
  const { event, rug } = scored;

  const solUsd = await getSolUsdRate();
  const priceSOL = event.price ?? (event.marketCapQuote != null ? event.marketCapQuote / 1_000_000_000 : 0);
  const entryPriceUSD = priceSOL * solUsd;

  const bought = await executor.buy({
    token: event.name,
    ca: event.mint,
    priceUSD: entryPriceUSD,
    dex: event.pool,
    mcap: event.marketCapQuote,
    rug,
  });

  if (bought) {
    addPosition(
      event.mint,
      event.mint,
      event.name,
      priceSOL,
      CONFIG.positionSizeSol,
      { marketCapUSD: event.marketCapQuote, dex: event.pool },
      "SOL",
    );
    console.log(`[Pipeline] Bought ${event.symbol}`);
  } else {
    console.log(`[Pipeline] Skipped ${event.symbol} (buy rejected)`);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

initTelegramBot();
startPumpDevListener(positions, pumpDevPrices);
startPumpAPIListener();
startPipeline();
engine.start();

console.log(`Bot started — ${wallet.getBalance()} SOL, ${positions.count()} positions`);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("\nShutting down...");
  engine.stop();
  stopPipeline();
  stopPumpDevListener();
  stopPumpAPIListener();
  shutdownTelegramBot();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
