import type { NewTokenEvent, QualityScore } from "../pipeline/types";

const WEIGHTS = {
  mintRevoked: 25,
  freezeRevoked: 20,
  mayhemMode: -10,
  cashbackEnabled: 5,
  burnedLiquidity: 15,
  poolCreatedByPump: 15,
  poolFeeRate: 10,
};

export function tokenQualityFilter(event: NewTokenEvent): QualityScore {
  let score = 0;
  const maxScore = Object.values(WEIGHTS).reduce((a, b) => a + Math.abs(b), 0);
  const details: Record<string, number> = {};

  if (event.mintRevoked) {
    score += WEIGHTS.mintRevoked;
    details.mintRevoked = WEIGHTS.mintRevoked;
  } else {
    details.mintRevoked = 0;
  }

  if (event.freezeRevoked) {
    score += WEIGHTS.freezeRevoked;
    details.freezeRevoked = WEIGHTS.freezeRevoked;
  } else {
    details.freezeRevoked = 0;
  }

  if (event.mayhemMode) {
    score += WEIGHTS.mayhemMode;
    details.mayhemMode = WEIGHTS.mayhemMode;
  } else {
    details.mayhemMode = 0;
  }

  if (event.cashbackEnabled) {
    score += WEIGHTS.cashbackEnabled;
    details.cashbackEnabled = WEIGHTS.cashbackEnabled;
  } else {
    details.cashbackEnabled = 0;
  }

  if (event.burnedLiquidityPct != null) {
    const bp = Math.min(event.burnedLiquidityPct, 100);
    details.burnedLiquidity = Math.round(WEIGHTS.burnedLiquidity * (bp / 100));
    score += details.burnedLiquidity;
  } else {
    details.burnedLiquidity = 0;
  }

  if (event.poolCreatedBy === "pump") {
    score += WEIGHTS.poolCreatedByPump;
    details.poolCreatedByPump = WEIGHTS.poolCreatedByPump;
  } else {
    details.poolCreatedByPump = 0;
  }

  if (event.poolFeeRate != null) {
    const rateScore = event.poolFeeRate <= 0.0125
      ? WEIGHTS.poolFeeRate
      : Math.round(WEIGHTS.poolFeeRate * Math.max(0, 1 - (event.poolFeeRate - 0.0125) / 0.1));
    details.poolFeeRate = rateScore;
    score += rateScore;
  } else {
    details.poolFeeRate = 0;
  }

  return { score, maxScore, details };
}
