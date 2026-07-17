# pumpdev-jupiter-telegram

Paper-trading bot that streams new token launches from **PumpAPI** (`wss://stream.pumpapi.io/`) and **PumpDev** (`wss://pumpdev.io/ws`), runs them through a filter pipeline (initial filter → quality scoring → RugCheck), and executes paper buys via Jupiter v3 pricing.

## Quick Start

```bash
cp .env.example .env     # fill in your keys
bun install
bun start
```

## Pipeline

```
PumpAPI WS ─┐
             ├─► initialFilter ─► tokenQualityFilter ─► signalQueue ─► RugCheck ─► compositeScore ─► execute
PumpDev WS ─┘
```

1. **Ingest** — Both WS streams emit `NewTokenEvent` on `action: "create"` / `txType: "create"`
2. **Filter** — `initial_filter.ts` rejects based on symbol/`PUMP` suffix, min mcap, min initialBuy, max fee, min burned liquidity
3. **Score** — `token_quality_filter.ts` assigns a weighted pre-Rug score (mintRevoked, freezeRevoked, mayhem, cashback, poolCreatedBy, feeRate)
4. **Queue** — Surviving tokens enter a TTL-bound signal queue with dedup
5. **RugCheck** — Periodic dequeue → `getRugAnalysis` API → composite score (quality + RugCheck)
6. **Execute** — `PaperExecutor.buy()` if composite ≥ 50, else skip

## Price Chain

| Source | Priority | Use |
|---|---|---|
| `PumpDev WS` | Primary | Token SOL price from trade events (seeded on buy) |
| Jupiter Price API v3 | Fallback | Token USD price (requires `JUPITER_API_KEY`) |
| `crypull` + Jupiter v3 | SOL/USD | SOL/USD rate for USD→SOL conversion |

## Exit Strategies

Modular strategy system driven by `PositionEngine`:

| Strategy | Config | Behaviour |
|---|---|---|
| StopLoss | `STOP_LOSS_PERCENT` | Close at configured loss % |
| TrailingStop | `TRAILING_ACTIVATION_PERCENT` / `TRAILING_STOP_PERCENT` | Trail from peak after gain threshold |
| TTL | `BASE_TTL_SECS` / `MAX_TTL_SECS` / `TTL_RENEW_THRESHOLD_PERCENT` | Base expiry + auto-renew on price movement + hard cap |
| PartialTP | `PARTIAL_TP_TIERS` | Scale out at configurable profit tiers |

## Config

See `.env.example` — all params with defaults in `src/config.ts`.

## Architecture

```
src/
├── index.ts                    # Wiring: WS → pipeline → engine → exit
├── config.ts                   # Env-based config with types
├── types.ts                    # Signal, Position, TradeRecord
├── pipeline/
│   ├── types.ts                # NewTokenEvent, FilterResult, QualityScore
│   ├── signal_queue.ts         # TTL-bound queue with dedup
│   └── pipeline.ts             # Orchestrator: merge WS → filter → queue → RugCheck → execute
├── filter/
│   ├── initial_filter.ts       # Fast sync filter (symbol, mcap, fee, liquidity)
│   └── token_quality_filter.ts # Weighted pre-Rug scoring
├── pumpapi/
│   └── listener.ts             # WS client for wss://stream.pumpapi.io/ (create events)
├── pumpdev/
│   └── listener.ts             # WS client for wss://pumpdev.io/ws (subscribeNewToken + subscribeTokenTrade)
├── trading/
│   ├── paper_executor.ts       # Buy/sell with USD↔SOL conversion
│   ├── paper_wallet.ts         # Balance tracking
│   ├── position.ts             # PositionManager (CA-keyed)
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
├── telegram/
│   ├── telegram_bot.ts         # GrammY notifications (buy/sell/report)
│   ├── telegram_client.ts      # MTProto listener (DISABLED — preserved)
│   ├── telegram_signal_queue.ts# TTL queue with dedup (DISABLED — preserved)
│   └── ave_scanner_parser.ts   # Signal text → structured data (DISABLED — preserved)
├── jupiter/
│   └── price.ts                # Re-exports JupiterPriceProvider
└── utils/
    └── sol_usd.ts              # crypull → Jupiter v3 → 150 fallback
```

## Telegram

- **Signal listener** — disabled. Code preserved in `src/telegram/` for re-enable.
- **Bot reporting** — active. Sends buy/sell/report notifications via GrammY (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`).
