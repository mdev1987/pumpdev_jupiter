export interface NewTokenEvent {
  source: "pumpdev" | "pumpapi";
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  pool: string;
  initialBuy?: number;
  marketCapQuote?: number;
  solAmount?: number;
  price?: number;
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  poolFeeRate?: number;
  mayhemMode?: boolean;
  cashbackEnabled?: boolean;
  burnedLiquidityPct?: number;
  poolCreatedBy?: string;
  txSigner?: string;
  signature?: string;
  timestamp: number;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export interface QualityScore {
  score: number;
  maxScore: number;
  details: Record<string, number>;
}
