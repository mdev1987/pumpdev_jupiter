import { CONFIG } from "../config";
import { getRugAnalysis, buildRugFromApi } from "../utils/rug_check";
import { getSolUsdRate } from "../utils/sol_usd";
import {
  sendTelegram,
  fmtPrice,
  fmtMcap,
  fmtPct,
} from "../telegram/telegram_bot";
import type { PaperExecutor } from "../trading/paper_executor";

const WS_URL = "wss://stream.cabalspy.xyz";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let executor: PaperExecutor | null = null;
let callbacks: {
  onBuy?: (ca: string, name: string, entryPriceUSD: number, sizeSol: number) => void;
  onSell?: (ca: string) => void;
} | undefined;

function connect(cbs?: {
  onBuy?: (ca: string, name: string, entryPriceUSD: number, sizeSol: number) => void;
  onSell?: (ca: string) => void;
}) {
  callbacks = cbs;
  const apiKey = CONFIG.cabalspyApiKey;
  if (!apiKey) {
    console.warn("[CabalSpy] No API key configured");
    return;
  }

  if (
    ws?.readyState === WebSocket.OPEN ||
    ws?.readyState === WebSocket.CONNECTING
  )
    return;

  try {
    ws = new WebSocket(`${WS_URL}?apiKey=${apiKey}`);
  } catch (err) {
    console.error("[CabalSpy] Failed to create WebSocket:", err);
    scheduleReconnect();
    return;
  }

  /*
  Profile 1 – Aggressive (Discovery)

Catches trends early.

{
  "kol": {
    "min_buy": 0.5,
    "entry_at": [3, 5],
    "exit_at": [1]
  },
  "smart": {
    "min_buy": 0.75,
    "entry_at": [2],
    "exit_at": [1]
  },
  "min_win_rate": 55,
  "min_token_age": 1,
  "max_token_age": 48
}
  */

  /*
Profile 2 – Balanced ⭐ (My recommendation)

This is the one I'd optimize for eventual live trading.

{
  "kol": {
    "min_buy": 0.75,
    "entry_at": [3, 5],
    "exit_at": [2]
  },
  "smart": {
    "min_buy": 1.0,
    "entry_at": [2],
    "exit_at": [1]
  },
  "min_win_rate": 60,
  "min_token_age": 2,
  "max_token_age": 60
}
*/

  ws.onopen = () => {
    console.log("[CabalSpy] Connected");
    ws!.send(
      JSON.stringify({
        op: "subscribe",
        stream: "signal",
        blockchain: "solana",
        token: "*",
        kol: {
          min_buy: 0.1,
          entry_at: [1],
          exit_at: [1],
        },
      }),
    );
    console.log("[CabalSpy] Subscribed (kol entry_at=[1])");
  };

  ws.onmessage = async (raw) => {
    try {
      const rawData = raw.data;
      const text =
        typeof rawData === "string"
          ? rawData
          : rawData instanceof Buffer
            ? rawData.toString()
            : rawData instanceof ArrayBuffer
              ? new TextDecoder().decode(rawData)
              : String(rawData);
      const msg = JSON.parse(text);

      if (msg.event !== "signal") return;
      if (!msg.data) return;

      const d = msg.data;
      const mint = d.mint;
      const kind = d.signal_kind;
      const symbol = d.token?.symbol ?? "???";
      const name = d.token?.name ?? "Unknown";
      const mcap = d.token?.market_cap;
      const mcapUsd = d.token?.market_cap_usd;

      const cluster = d.cluster;
      const wallets = d.wallets ?? [];
      const walletCount = cluster?.qualifying_total ?? wallets.length;
      const totalInvested = cluster?.total_invested;
      const totalInvestedUsd = cluster?.total_invested_usd;
      const unrealizedPnlPct = cluster?.unrealized_pnl_pct;

      if (kind === "entry") {
        let rugStr = "";
        let apiResult: Awaited<ReturnType<typeof getRugAnalysis>> | undefined;
        try {
          apiResult = await getRugAnalysis(mint);
          const rug = buildRugFromApi(apiResult);
          const badge =
            rug.verdict === "PASS"
              ? "🟢"
              : rug.verdict === "WARN"
                ? "🟡"
                : "🔴";
          rugStr = `${badge} Verdict: ${rug.verdict ?? "?"} · Score: ${rug.score}`;
          if (rug.mintRevoked !== undefined)
            rugStr += ` · Mint: ${rug.mintRevoked ? "✅" : "❌"}`;
          if (rug.freezeRevoked !== undefined)
            rugStr += ` · Freeze: ${rug.freezeRevoked ? "✅" : "❌"}`;
          if (rug.lpLockedPct != null)
            rugStr += ` · LP: ${rug.lpLockedPct.toFixed(1)}%`;
          if (rug.top10Pct != null)
            rugStr += ` · Top10: ${rug.top10Pct.toFixed(1)}%`;
          if (rug.flags?.length) rugStr += ` · Flags: ${rug.flags.join(", ")}`;

          const rugReport = [
            `🛡 **RugCheck — ${symbol}**`,
            `━━━━━━━━━━━━━━━━━━━`,
            `🔖 Token: \`${name}\` (\`${symbol}\`)`,
            `🔗 Mint: \`${mint}\``,
            `📊 MCap: ${fmtMcap(mcapUsd ?? 0)}`,
            rugStr,
            ...(rug.priceUsd != null ? [`💵 Price: $${rug.priceUsd}`] : []),
          ].join("\n");
          sendTelegram(rugReport);
        } catch (err) {
          sendTelegram(
            `⚠️ **RugCheck Failed — ${symbol}**\n\`${mint}\`\n❌ ${err}`,
          );
        }

        if (executor) {
          const solUsd = await getSolUsdRate();
          const priceSOL = mcap != null ? mcap / 1_000_000_000 : 0;
          const entryPriceUSD = priceSOL * solUsd;

          const bought = await executor.buy({
            token: name,
            ca: mint,
            priceUSD: entryPriceUSD,
            dex: "pump",
            mcap: mcapUsd,
            source: "cabalspy",
            rug: apiResult ? buildRugFromApi(apiResult) : undefined,
          });

          if (bought && callbacks?.onBuy) {
            callbacks.onBuy(mint, name, entryPriceUSD, CONFIG.positionSizeSol);
          }

          const entryReport = [
            bought
              ? `🟢 **CabalSpy Buy — ${symbol}**`
              : `⛔ **CabalSpy Buy Rejected — ${symbol}**`,
            `━━━━━━━━━━━━━━━━━━━`,
            `🔖 Token: \`${name}\``,
            `🔗 Mint: \`${mint}\``,
            `📊 MCap: ${mcap != null ? fmtMcap(mcapUsd ?? 0) : "?"}`,
            `👥 Wallets: \`${walletCount}\``,
            totalInvested != null
              ? `💰 Cluster invested: \`${totalInvested} SOL\``
              : null,
            totalInvestedUsd != null
              ? `💵 Cluster invested USD: \`$${totalInvestedUsd.toFixed(2)}\``
              : null,
            !bought ? `📋 Reason: max positions or insufficient balance` : null,
          ]
            .filter(Boolean)
            .join("\n");
          sendTelegram(entryReport);
        }
      }

      if (kind === "exit" && executor) {
        await executor.sell(mint, "cabalspy_exit");
        callbacks?.onSell?.(mint);

        const exitReport = [
          `🔴 **CabalSpy Sell — ${symbol}**`,
          `━━━━━━━━━━━━━━━━━━━`,
          `🔖 Token: \`${name}\``,
          `🔗 Mint: \`${mint}\``,
          `👥 Wallets: \`${walletCount}\``,
          cluster?.unrealized_pnl_pct != null
            ? `📈 Cluster PnL: ${fmtPct(unrealizedPnlPct! / 100)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
        sendTelegram(exitReport);
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => {
    console.log("[CabalSpy] Disconnected");
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error("[CabalSpy] Error:", err);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(callbacks);
  }, 5000);
}

export function startCabalSpy(
  ex: PaperExecutor,
  callbacks?: {
    onBuy?: (ca: string, name: string, entryPriceUSD: number, sizeSol: number) => void;
    onSell?: (ca: string) => void;
  },
) {
  executor = ex;
  connect(callbacks);
}

export function stopCabalSpy() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  executor = null;
}
