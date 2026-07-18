import { CONFIG } from "../config";
import { PaperWallet } from "./paper_wallet";
import { PositionManager } from "./position";
import { TradeStore } from "./trade_store";
import { PriceRouter, type PriceResult } from "./price_provider";
import { getSolUsdRate } from "../utils/sol_usd";
import { notifyTradeClosed } from "../telegram/telegram_bot";
import type { RugInfo } from "../utils/rug_check";

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
  rug?: RugInfo;
  source?: string;
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

    console.log(`[Executor] Bought ${signal.token} @ ${entryPriceSOL} SOL (src=${signal.source ?? "?"})`);
    return true;
  }

  async sell(ca: string, reason: string) {
    const p = this.positions.get(ca);
    if (!p) return;

    const result: PriceResult | null = await this.prices.getPriceWithSource(ca);
    const priceSOL = result?.price ?? p.currentPriceSOL;
    const source = result?.source ?? "cache";

    const pnl = priceSOL > 0 && p.entryPriceSOL > 0
      ? (priceSOL - p.entryPriceSOL) / p.entryPriceSOL
      : 0;
    const value = Number.isFinite(pnl) ? p.amountSol * (1 + pnl) : p.amountSol;

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
    if (p.entryPriceSOL <= 0 && priceSOL > 0) {
      p.entryPriceSOL = priceSOL;
    }
    p.currentPriceSOL = priceSOL;
    if (priceSOL > p.peakPriceSOL) {
      p.peakPriceSOL = priceSOL;
    }
  }

  getPosition(ca: string) {
    return this.positions.get(ca);
  }

  getBalance(): number {
    return this.wallet.getBalance();
  }

  getPositionCount(): number {
    return this.positions.count();
  }
}
