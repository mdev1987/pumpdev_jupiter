import { Subject, interval } from "rxjs";

import { CONFIG } from "./config";
import { PaperWallet } from "./trading/paper_wallet";
import { PositionManager } from "./trading/position";
import { PaperExecutor } from "./trading/paper_executor";
import { TradeStore } from "./trading/trade_store";
import { PumpDevPriceProvider, JupiterPriceProvider, PriceRouter } from "./trading/price_provider";
import { initTelegramBot, shutdownTelegramBot } from "./telegram/telegram_bot";

import { startCabalSpy, stopCabalSpy } from "./cabalspy/listener";

const wallet = new PaperWallet(CONFIG.paperBalanceSol);
const store = new TradeStore(CONFIG.dbPath);
const executor = new PaperExecutor(wallet, new PositionManager(), store, new PriceRouter(new PumpDevPriceProvider(), new JupiterPriceProvider()));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

initTelegramBot();
startCabalSpy(executor);

console.log(`Bot started — ${wallet.getBalance()} SOL`);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("\nShutting down...");
  stopCabalSpy();
  shutdownTelegramBot();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
