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
2. **Buy** — PaperExecutor seeds PumpDev cache, stores trade in SQLite, notifies Telegram, adds position to strategy store
3. **Track** — Price stream polls every 5s → pushes `PriceInfo` into `PositionEngine` → updates strategy store prices
4. **Exit** — `PositionEngine` runs registered exit strategies (StopLoss, TrailingStop, TTL, PartialTP) on each scan interval. First strategy that triggers wins → `exitDecision$` emits → `PaperExecutor.sell()` executes
5. **Queue** — Rejected buys (max positions) re-enqueue with TTL

## Price Chain

| Source | Priority | Use |
|---|---|---|
| `crypull.price('SOL')` | SOL/USD rate | Aggregates Binance, CoinGecko, etc. |
| Jupiter Price API v3 | Token USD price | Requires `JUPITER_API_KEY` |
| PumpDev WS | Token SOL price | Seeded on buy, refreshed by WS trade events |

## Config

See `.env.example` — all params with defaults in `src/config.ts`.

## Architecture

```
src/
├── index.ts                    # Wiring: signal → buy → engine → exit
├── config.ts                   # Env-based config with types
├── types.ts                    # Signal, TradeRecord
├── telegram/
│   ├── telegram_bot.ts         # GrammY notifications
│   ├── telegram_client.ts      # MTProto listener
│   ├── telegram_signal_queue.ts# TTL queue with dedup
│   └── ave_scanner_parser.ts   # Signal text → structured data
├── trading/
│   ├── paper_executor.ts       # Buy/sell with USD↔SOL conversion
│   ├── paper_wallet.ts         # Balance tracking
│   ├── position.ts             # PositionManager (CA-keyed, used by pumpdev WS)
│   ├── price_provider.ts       # PumpDev cache, Jupiter v3, PriceRouter
│   └── trade_store.ts          # bun:sqlite
├── strategy/
│   ├── types.ts                # Position, PriceInfo, ExitDecision, enums
│   ├── store.ts                # Position repository (Map + RxJS subjects)
│   ├── scanner.ts              # Strategy registry + scan loop + exitDecision$
│   ├── engine.ts               # RxJS engine: price stream → store → scanner
│   └── exit-strategies/
│       ├── types.ts            # ExitStrategy interface
│       ├── stop-loss.ts        # Close at configured loss %
│       ├── trailing-stop.ts    # Trail from peak after activation %
│       ├── partial-tp.ts       # Scale out at configurable tiers
│       └── ttl.ts              # Base expiry + auto-renew + hard cap
├── pumpdev/
│   └── listener.ts             # WS subscribeTokenTrade
├── jupiter/
│   └── price.ts                # Re-exports JupiterPriceProvider
└── utils/
    └── sol_usd.ts              # crypull → Jupiter v3 → 150 fallback
```

## Telegram Messages

- **Open** — token, size, entry, dex, price source, mcap, risk, security flags
- **Close** — token, dex, PnL, entry/exit/peak, reason, duration, price source
- **Report** — aggregate stats, win rate, profit factor, exit type breakdown
