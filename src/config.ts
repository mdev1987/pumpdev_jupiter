export interface PartialTpTier {
  at: number;
  pct: number;
}

function number(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseTiers(raw?: string): PartialTpTier[] {
  if (!raw) return [];
  return raw.split(";").map((t) => {
    const [at, pct] = t.split(",");
    return { at: Number(at), pct: Number(pct) };
  }).filter((t) => Number.isFinite(t.at) && Number.isFinite(t.pct));
}

export const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  telegramApiId: process.env.TELEGRAM_API_ID,
  telegramApiHash: process.env.TELEGRAM_API_HASH,
  telegramChannelUserName: (process.env.TELEGRAM_CHANNEL_USERNAME ?? "").trim().toLowerCase(),
  telegramChannelId: process.env.TELEGRAM_CHANNEL_ID,
  telegramSessionName: process.env.TELEGRAM_SESSION_NAME ?? "telegram_session",
  tgConnectionRetries: number("TG_CONNECTION_RETRIES", 5),
  tgRetryDelayMs: number("TG_RETRY_DELAY_MS", 5000),
  tgAuthTimeoutMs: number("TG_AUTH_TIMEOUT_MS", 300000),

  signalQueueMaxSize: number("SIGNAL_QUEUE_MAX_SIZE", 50),
  signalQueueTtlMs: number("SIGNAL_QUEUE_TTL_MS", 600000),

  paperBalanceSol: number("PAPER_BALANCE_SOL", 0.5),
  positionSizeSol: number("POSITION_SIZE_SOL", 0.01),
  maxPositionSol: number("MAX_POSITION_SOL", 0.1),
  maxOpenPositions: number("MAX_OPEN_POSITIONS", 3),

  stopLossPct: number("STOP_LOSS_PERCENT", -15) / 100,
  takeProfitPct: number("TAKE_PROFIT_PERCENT", 200) / 100,
  trailingActivationPct: number("TRAILING_ACTIVATION_PERCENT", 15) / 100,
  trailingStopPct: number("TRAILING_STOP_PERCENT", 8) / 100,

  baseTtlSecs: number("BASE_TTL_SECS", 90),
  maxTtlSecs: number("MAX_TTL_SECS", 600),
  ttlRenewThresholdPct: number("TTL_RENEW_THRESHOLD_PERCENT", 8) / 100,

  partialTpTiers: parseTiers(process.env.PARTIAL_TP_TIERS),

  pumpdevApiKey: process.env.PUMPDEV_API_KEY,
  pumpdevWsUrl: process.env.PUMPDEV_WS_URL ?? "wss://pumpdev.io/ws",
  pumpdevBaseUrl: process.env.PUMPDEV_BASE_URL ?? "https://pumpdev.io",

  cabalspyApiKey: process.env.CABALSPY_API_KEY,

  jupiterApiKey: process.env.JUPITER_API_KEY,
  jupiterBaseUrl: process.env.JUPITER_BASE_URL ?? "https://api.jup.ag/swap/v2",

  pricePollIntervalMs: number("PRICE_POLL_INTERVAL_MS", 5000),
  positionScanIntervalMs: number("POSITION_SCAN_INTERVAL_MS", 5000),
  dbPath: process.env.DB_PATH ?? "./data/trades.db",

  solUsdFallback: number("SOL_USD_FALLBACK", 150),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
