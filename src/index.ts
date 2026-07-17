import { CONFIG } from "./config";
import { initTelegramBot, shutdownTelegramBot } from "./telegram/telegram_bot";
import { startTelegramListener, stopTelegramListener } from "./telegram/telegram_client";
import { initSignalQueue, stopSignalQueue, enqueueSignal, signalQueued$ } from "./telegram/telegram_signal_queue";
import { PaperWallet } from "./trading/paper_wallet";
import { PositionManager } from "./trading/position";
import { PaperExecutor } from "./trading/paper_executor";
import { PriceTracker } from "./trading/price_tracker";
import { TradeStore } from "./trading/trade_store";
import { PumpDevPriceProvider, JupiterPriceProvider, PriceRouter } from "./trading/price_provider";
import { startPumpDevListener, stopPumpDevListener } from "./pumpdev/listener";

const wallet = new PaperWallet(CONFIG.paperBalanceSol);
const positions = new PositionManager();
const store = new TradeStore(CONFIG.dbPath);

const pumpDevPrices = new PumpDevPriceProvider();
const jupiterPrices = new JupiterPriceProvider();
const prices = new PriceRouter(pumpDevPrices, jupiterPrices);

const executor = new PaperExecutor(wallet, positions, store, prices);
const priceTracker = new PriceTracker(positions, executor, prices);

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

  if (!bought) {
    enqueueSignal(queued);
  }
});

startPumpDevListener(positions, pumpDevPrices);
priceTracker.start();

console.log(`Bot started — ${wallet.getBalance()} SOL, ${positions.count()} positions`);

async function shutdown() {
  console.log("\nShutting down...");
  priceTracker.stop();
  stopPumpDevListener();
  stopSignalQueue();
  await stopTelegramListener().catch(() => {});
  shutdownTelegramBot();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
