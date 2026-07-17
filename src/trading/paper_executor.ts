import { CONFIG } from "../config";
import { PaperWallet } from "./paper_wallet";
import { PositionManager } from "./position";
import { TradeStore } from "./trade_store";
import { PriceRouter, type PriceResult } from "./price_provider";
import { getSolUsdRate } from "../utils/sol_usd";
import { notifyBuyOpened, notifyTradeClosed } from "../telegram/telegram_bot";

function allowBuy(balance: number, amount: number): boolean {
  if (amount > CONFIG.maxPositionSol) return false;
  if (balance < amount) return false;
  return true;
}

export interface BuySignal {
  token: string;
  ca: string;
  priceUSD: number;
  dex?: string;
  mcap?: number;
  riskLevel?: string;
  riskScore?: number;
  securityFlags?: {
    ownershipRenounced?: boolean;
    top10HoldingsBelow30Pct?: boolean;
    stopMint?: boolean;
    noBlacklist?: boolean;
  };
}

export class PaperExecutor {
  constructor(
    private wallet: PaperWallet,
    private positions: PositionManager,
    private store: TradeStore,
    private prices: PriceRouter,
  ) {}

  async buy(signal: BuySignal): Promise<boolean> {
    if (this.positions.count() >= CONFIG.maxOpenPositions) {
      return false;
    }

    const size = CONFIG.positionSizeSol;

    if (!allowBuy(this.wallet.getBalance(), size)) {
      return false;
    }

    const solUsd = await getSolUsdRate();
    const entryPriceSOL = signal.priceUSD > 0 ? signal.priceUSD / solUsd : 0;

    this.wallet.withdraw(size);

    const position = {
      token: signal.token,
      ca: signal.ca,
      dex: signal.dex,
      amountSol: size,
      entryPriceSOL,
      currentPriceSOL: entryPriceSOL,
      peakPriceSOL: entryPriceSOL,
      openedAt: Date.now(),
    };

    this.positions.add(position);
    this.prices.seedPrice(signal.ca, entryPriceSOL);

    this.store.insert({
      token: signal.token,
      ca: signal.ca,
      dex: signal.dex,
      side: "buy",
      amountSol: size,
      price: entryPriceSOL,
      balance: this.wallet.getBalance(),
      createdAt: Date.now(),
    });

    notifyBuyOpened(
      signal.token,
      size,
      this.wallet.getBalance(),
      "SOL",
      signal.mcap,
      signal.dex,
      this.positions.count(),
      CONFIG.maxOpenPositions,
      undefined,
      "SOL",
      entryPriceSOL,
      signal.riskLevel,
      signal.riskScore,
      signal.securityFlags,
      "pumpdev",
    );

    console.log(`[Executor] Bought ${signal.token} @ ${entryPriceSOL} SOL ($${signal.priceUSD} @ ${solUsd} SOL/USD)`);
    return true;
  }

  async sell(ca: string, reason: string) {
    const p = this.positions.get(ca);
    if (!p) return;

    const result: PriceResult | null = await this.prices.getPriceWithSource(ca);
    const priceSOL = result?.price ?? p.currentPriceSOL;
    const source = result?.source ?? "cache";

    const pnl = priceSOL > 0 ? (priceSOL - p.entryPriceSOL) / p.entryPriceSOL : 0;
    const value = p.amountSol * (1 + pnl);

    this.wallet.deposit(value);
    this.positions.remove(ca);
    const balance = this.wallet.getBalance();

    this.store.insert({
      token: p.token,
      ca: p.ca,
      dex: p.dex,
      side: "sell",
      amountSol: p.amountSol,
      price: priceSOL,
      pnl,
      reason,
      balance,
      createdAt: Date.now(),
    });

    notifyTradeClosed(
      p.token,
      pnl,
      p.entryPriceSOL,
      priceSOL,
      p.peakPriceSOL,
      p.amountSol,
      balance,
      "SOL",
      reason,
      Date.now() - p.openedAt,
      this.positions.count(),
      CONFIG.maxOpenPositions,
      undefined,
      "SOL",
      source,
      p.dex,
    );
  }

  updatePrice(ca: string, priceSOL: number) {
    const p = this.positions.get(ca);
    if (!p) return;
    p.currentPriceSOL = priceSOL;
    if (priceSOL > p.peakPriceSOL) {
      p.peakPriceSOL = priceSOL;
    }
  }
}
