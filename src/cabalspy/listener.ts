import { CONFIG } from "../config";
import { getRugAnalysis, buildRugFromApi } from "../utils/rug_check";
import { getSolUsdRate } from "../utils/sol_usd";
import { crypull } from "crypull";
import {
  sendTelegram,
  fmtPrice,
  fmtMcap,
  fmtPct,
} from "../telegram/telegram_bot";
import type { PaperExecutor } from "../trading/paper_executor";
import { log } from "../utils/logger";
import { DexScreenerPriceProvider, JupiterPriceProvider } from "../trading/price_provider";

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
    log.warn("cabalspy", "No API key configured");
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
    log.error("cabalspy", "Failed to create WebSocket:", err);
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

  /*
    Balanced ⭐ (Quality)
    KOL:  entry_at: [2,3]  min_buy: 0.3
    Smart: entry_at: [1]   min_buy: 0.5
    min_win_rate: 45
    Expect: 8–25 signals/day
  */

  ws.onopen = () => {
    log.success("cabalspy", "Connected");
    ws!.send(
      JSON.stringify({
        op: "subscribe",
        stream: "signal",
        blockchain: "solana",
        token: "*",
        kol: {
          min_buy: 0.2,
          entry_at: [1, 2],
          exit_at: [1],
        },
        smart: {
          min_buy: 0.5,
          entry_at: [1],
          exit_at: [1],
        },
        min_win_rate: 40,
        min_token_age: 0,
        max_token_age: 24,
      }),
    );
    log.success("cabalspy", "Subscribed — Aggressive (KOL entry_at=[1,2] min_buy=0.2 / Smart entry_at=[1] min_buy=0.5)");
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

      if (msg.event !== "signal") {
        if (msg.event === "subscribed" || msg.event === "error") {
          log.info("cabalspy", `Server: ${JSON.stringify(msg)}`);
        }
        return;
      }
      if (!msg.data) return;

      const d = msg.data;
      const mint = d.mint;
      const kind = d.signal_kind;
      const symbol = d.token?.symbol || "???";
      const name = d.token?.name || "Unknown";
      const mcap = d.token?.market_cap;
      let mcapUsd = d.token?.market_cap_usd;

      const cluster = d.cluster;
      const wallets = d.wallets ?? [];
      const walletCount = cluster?.qualifying_total ?? wallets.length;
      const totalInvested = cluster?.total_invested;
      const totalInvestedUsd = cluster?.total_invested_usd;
      const unrealizedPnlPct = cluster?.unrealized_pnl_pct;

      if (kind === "entry") {
        // Skip weak clusters — require at least 1 SOL total invested
        const MIN_CLUSTER_SOL = 1;
        if (!totalInvested || totalInvested < MIN_CLUSTER_SOL) {
          log.dev("cabalspy", `Skip ${symbol} — cluster ${totalInvested ?? 0} SOL < ${MIN_CLUSTER_SOL} SOL`);
          return;
        }

        let dexMcap: number | undefined;
        let dexPrice: number | undefined;
        try {
          const pools = await new DexScreenerPriceProvider().getPools(mint);
          const pool = pools[0];
          if (pool) {
            const pn = Number(pool.priceNative);
            if (Number.isFinite(pn) && pn > 0) dexPrice = pn;
            if (pool.marketCap) dexMcap = pool.marketCap;
            if (!mcapUsd && pool.fdv) mcapUsd = pool.fdv;
          }
        } catch {}

        let apiResult: Awaited<ReturnType<typeof getRugAnalysis>> | undefined;
        try {
          apiResult = await getRugAnalysis(mint);
        } catch (err) {
          sendTelegram(
            `⚠️ **RugCheck Failed — ${symbol}**\n\`${mint}\`\n❌ ${err}`,
          );
        }

        if (executor) {
          // Retry DexScreener if no price yet (new tokens may not be indexed)
          let resolvedDexPrice = dexPrice;
          if (!resolvedDexPrice) {
            // Retry DexScreener (5 attempts x 1s)
            for (let attempt = 0; attempt < 5; attempt++) {
              await sleep(1000);
              try {
                const pools = await new DexScreenerPriceProvider().getPools(mint);
                const pool = pools[0];
                if (pool) {
                  const pn = Number(pool.priceNative);
                  if (Number.isFinite(pn) && pn > 0) {
                    resolvedDexPrice = pn;
                    if (!dexMcap) {
                      if (pool.marketCap) dexMcap = pool.marketCap;
                      if (!mcapUsd && pool.fdv) mcapUsd = pool.fdv;
                    }
                  }
                }
              } catch {}
              if (resolvedDexPrice) break;
            }
            // Fallback: crypull (multi-provider, catches tokens not in DexScreener yet)
            if (!resolvedDexPrice) {
              try {
                const cp = await crypull.price(mint, "solana");
                if (cp?.priceUsd && cp.priceUsd > 0) {
                  const solUsd = await getSolUsdRate();
                  resolvedDexPrice = cp.priceUsd / solUsd;
                }
              } catch {}
            }
            // Fallback: Jupiter API
            if (!resolvedDexPrice) {
              try {
                const jp = await new JupiterPriceProvider().getPrice(mint);
                if (jp && jp > 0) {
                  resolvedDexPrice = jp;
                }
              } catch {}
            }
          }

          const displayMcap = mcapUsd ?? dexMcap ?? 0;
          const priceSOL = resolvedDexPrice ?? 0;
          const solUsd = await getSolUsdRate();
          const entryPriceUSD = priceSOL * solUsd;

          const rug = apiResult ? buildRugFromApi(apiResult) : undefined;

          const bought = await executor.buy({
            token: name,
            ca: mint,
            priceUSD: entryPriceUSD,
            dex: "pump",
            mcap: displayMcap,
            source: "cabalspy",
            rug,
          });

          if (bought && callbacks?.onBuy) {
            callbacks.onBuy(mint, name, entryPriceUSD, CONFIG.positionSizeSol);
          }

          // --- Build combined message ---

          const rugBadge = rug?.verdict === "PASS" ? "🟢" : rug?.verdict === "WARN" ? "🟡" : "🔴";

          // Section 1: RugCheck
          const rugSection = [
            `🛡 **RugCheck — ${symbol}**`,
            `━━━━━━━━━━━━━━━━━━━`,
            `🔖 Token: \`${name}\` (\`${symbol}\`)`,
            `🔗 Mint: \`${mint}\``,
            `📊 MCap: ${fmtMcap(displayMcap)}`,
            `${rugBadge} Verdict: ${rug?.verdict ?? "N/A"} · Score: ${rug?.score}` +
            (rug?.mintRevoked !== undefined ? ` · Mint: ${rug.mintRevoked ? "✅" : "❌"}` : "") +
            (rug?.freezeRevoked !== undefined ? ` · Freeze: ${rug.freezeRevoked ? "✅" : "❌"}` : "") +
            (rug?.lpLockedPct != null ? ` · LP: ${rug.lpLockedPct.toFixed(1)}%` : "") +
            (rug?.top10Pct != null ? ` · Top10: ${rug.top10Pct.toFixed(1)}%` : "") +
            (rug?.flags?.length ? ` · Flags: ${rug.flags.join(", ")}` : ""),
          ].join("\n");

          // Section 2: Position Opened
          const entryStr = priceSOL > 0 ? fmtPrice(priceSOL, "SOL") : "—";
          const balance = executor.getBalance();

          const posSection: string[] = [
            `🟢 **Position Opened**`,
            `━━━━━━━━━━━━━━━━━━━`,
            `🔖 Token: \`${name}\``,
            `💰 Size: \`${CONFIG.positionSizeSol} SOL\``,
            `💵 Entry: \`${entryStr}\``,
            `💳 Balance: \`${balance.toFixed(4)} SOL\``,
            `🏛 Dex: \`pump\``,
          ];

          if (rug) {
            posSection.push(`🛡 Rug: ${rugBadge} \`${rug.verdict ?? "?"}\` (score: \`${rug.score}\`)`);
            if (rug.established !== undefined) {
              const est = rug.established ? "✅" : "❌";
              const mintR = rug.mintRevoked ? "✅" : "❌";
              const freezeR = rug.freezeRevoked ? "✅" : "❌";
              posSection.push(`🔒 Established: ${est} · Mint: ${mintR} · Freeze: ${freezeR}`);
            }
            const lpLine: string[] = [];
            if (rug.lpLockedPct != null) lpLine.push(`LP: ${rug.lpLockedPct.toFixed(1)}%`);
            if (rug.top10Pct != null) lpLine.push(`Top10: ${rug.top10Pct.toFixed(1)}%`);
            if (rug.pairAgeHours != null) lpLine.push(`Age: ${rug.pairAgeHours.toFixed(0)}h`);
            if (lpLine.length) posSection.push(`🔐 ${lpLine.join(" · ")}`);
            if (rug.flags?.length) posSection.push(`🚩 Flags: \`${rug.flags.join(", ")}\``);
          }

          posSection.push(`📡 Price: \`cabalspy\``);
          posSection.push(`📊 Positions: \`${executor.getPositionCount()}/${CONFIG.maxOpenPositions}\``);

          // Section 3: CabalSpy Buy
          const buySection: string[] = [
            bought
              ? `🟢 **CabalSpy Buy — ${symbol}**`
              : `⛔ **CabalSpy Buy Rejected — ${symbol}**`,
            `━━━━━━━━━━━━━━━━━━━`,
            `🔖 Token: \`${name}\``,
            `🔗 Mint: \`${mint}\``,
            `📊 MCap: ${fmtMcap(displayMcap)}`,
            `👥 Wallets: \`${walletCount}\``,
          ];

          if (totalInvested != null) {
            buySection.push(`💰 Cluster invested: \`${totalInvested} SOL\``);
          }
          if (totalInvestedUsd != null) {
            buySection.push(`💵 Cluster invested USD: \`$${totalInvestedUsd.toFixed(2)}\``);
          }
          if (!bought) {
            buySection.push(`📋 Reason: max positions or insufficient balance`);
          }

          sendTelegram(rugSection + "\n\n" + posSection.join("\n") + "\n\n" + buySection.join("\n"));
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
    log.warn("cabalspy", "Disconnected");
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    log.error("cabalspy", "Error:", err);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
