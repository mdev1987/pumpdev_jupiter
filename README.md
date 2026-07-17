# pumpdev-jupiter-telegram

Paper-trading bot that listens to Ave Scanner Telegram signals, buys tokens via pump.fun pricing and Jupiter fallback, and tracks all trades in SQLite.

## Quick Start

```bash
cp .env.example .env     # fill in your keys
bun install
bun start
```

## How it Works

1. **Signal** — Telegram listener captures Ave Scanner signals → parsed into token/CA/price/dex/security
2. **Buy** — PaperExecutor seeds PumpDev cache with entry price, stores position in SQLite, notifies Telegram
3. **Track** — PriceTracker polls every 5s: PumpDev WS cache (30s TTL) → Jupiter Price API v3 fallback
4. **Exit** — Risk engine checks SL/TP/trailing/TTL every tick → sells via PaperExecutor
5. **Queue** — Rejected buys (max positions) re-enqueue with TTL

## Price Chain

| Source | Priority | Caveat |
|---|---|---|
| `crypull.price('SOL')` | SOL/USD rate | Aggregates Binance, CoinGecko, etc. |
| Jupiter Price API v3 | Token USD price | Requires `JUPITER_API_KEY` |
| PumpDev WS | Token price for pump.fun tokens | Seeded on buy, refreshed by WS trade events |

## Config

See `.env.example` — all params with defaults in `src/config.ts`.

## Architecture

```
src/
├── index.ts                     # Wiring: signal → buy → track → exit
├── config.ts                    # Env-based config
├── types.ts                     # Signal, Position, TradeRecord
├── telegram/
│   ├── telegram_bot.ts          # GrammY notifications (open/close/report)
│   ├── telegram_client.ts       # MTProto listener for Ave Scanner
│   ├── telegram_signal_queue.ts # TTL queue with dedup
│   └── ave_scanner_parser.ts    # Signal text → structured data
├── trading/
│   ├── paper_executor.ts        # Buy/sell with USD↔SOL conversion
│   ├── paper_wallet.ts          # Balance tracking
│   ├── position.ts              # Open position registry
│   ├── price_tracker.ts         # Poll loop + exit evaluation
│   ├── price_provider.ts        # PumpDev cache, Jupiter v3, PriceRouter
│   ├── risk.ts                  # allowBuy + evaluateExit (SL/TP/trailing/TTL)
│   └── trade_store.ts           # bun:sqlite
├── pumpdev/
│   └── listener.ts              # WS subscribeTokenTrade
├── jupiter/
│   └── price.ts                 # Re-exports JupiterPriceProvider
└── utils/
    └── sol_usd.ts               # crypull → Jupiter v3 → 150 fallback
```

## Telegram Messages

- **Open** — token, size, entry, dex, price source, mcap, risk, security flags
- **Close** — token, dex, PnL, entry/exit/peak, reason, duration, price source
- **Report** — aggregate stats, win rate, profit factor, exit type breakdown
