export interface Signal {
  token: string;
  ca: string;
  price: number;
  mcap?: number;
}

export interface Position {
  token: string;
  ca: string;
  dex?: string;
  amountSol: number;
  entryPriceSOL: number;
  currentPriceSOL: number;
  peakPriceSOL: number;
  openedAt: number;
}

export interface TradeRecord {
  id?: number;
  token: string;
  ca: string;
  dex?: string;
  side: "buy" | "sell";
  amountSol: number;
  price: number;
  pnl?: number;
  reason?: string;
  balance: number;
  createdAt: number;
}
