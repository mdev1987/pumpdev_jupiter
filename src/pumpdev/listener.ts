import { Subject } from "rxjs";
import { CONFIG } from "../config";
import { PositionManager } from "../trading/position";
import { PumpDevPriceProvider } from "../trading/price_provider";
import type { NewTokenEvent } from "../pipeline/types";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedMints = new Set<string>();
let subscribedNewTokens = false;

export const pumpdevNewToken$ = new Subject<NewTokenEvent>();

function connect(
  positions: PositionManager,
  priceProvider: PumpDevPriceProvider,
) {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    ws = new WebSocket(CONFIG.pumpdevWsUrl);
  } catch (err) {
    console.error("[PumpDev] Failed to create WebSocket:", err);
    scheduleReconnect(positions, priceProvider);
    return;
  }

  ws.onopen = () => {
    console.log("[PumpDev] Connected");
    subscribedNewTokens = false;
    subscribedMints.clear();
    syncSubscriptions(positions);
  };

  ws.onmessage = (raw) => {
    try {
      const rawData = raw.data;
      const text = typeof rawData === "string" ? rawData : rawData instanceof Buffer ? rawData.toString() : rawData instanceof ArrayBuffer ? new TextDecoder().decode(rawData) : String(rawData);
      const e = JSON.parse(text);

      if (e.txType === "create") {
        const mintRevoked = false;
        const freezeRevoked = false;

        pumpdevNewToken$.next({
          source: "pumpdev",
          mint: e.mint,
          name: e.name ?? "Unknown",
          symbol: e.symbol ?? "???",
          uri: e.uri,
          pool: "pump",
          initialBuy: e.initialBuy,
          marketCapQuote: e.marketCapSol != null ? e.marketCapSol * (CONFIG.solUsdFallback ?? 150) : undefined,
          solAmount: e.solAmount,
          price: e.marketCapSol != null ? e.marketCapSol / 1_000_000_000 : undefined,
          mintRevoked,
          freezeRevoked,
          txSigner: e.traderPublicKey,
          signature: e.signature,
          timestamp: Date.now(),
        });

        return;
      }

      if ((e.txType === "buy" || e.txType === "sell") && e.solAmount && e.tokenAmount) {
        const solAmount = Number(e.solAmount);
        const tokenAmount = Number(e.tokenAmount);
        if (solAmount > 0 && tokenAmount > 0) {
          const price = solAmount / tokenAmount;
          priceProvider.updatePrice(e.mint, price);

          const pos = positions.get(e.mint);
          if (pos) {
            console.log(`[PumpDev] ${pos.token} trade: ${e.txType} @ ${price} SOL`);
          }
        }
      }
    } catch {
      /* ignore parse errors */
    }
  };

  ws.onclose = () => {
    console.log("[PumpDev] Disconnected");
    ws = null;
    scheduleReconnect(positions, priceProvider);
  };

  ws.onerror = (err) => {
    console.error("[PumpDev] Error:", err);
  };
}

function scheduleReconnect(
  positions: PositionManager,
  priceProvider: PumpDevPriceProvider,
) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(positions, priceProvider);
  }, 5000);
}

function syncSubscriptions(positions: PositionManager) {
  if (!subscribedNewTokens) {
    ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
    subscribedNewTokens = true;
  }

  const held = new Set(positions.all().map((p) => p.ca));
  const toAdd = [...held].filter((m) => !subscribedMints.has(m));
  const toRemove = [...subscribedMints].filter((m) => !held.has(m));

  if (toRemove.length > 0) {
    ws?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: toRemove }));
    toRemove.forEach((m) => subscribedMints.delete(m));
  }

  if (toAdd.length > 0) {
    ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: toAdd }));
    toAdd.forEach((m) => subscribedMints.add(m));
    console.log(`[PumpDev] Subscribed to ${toAdd.length} token(s)`);
  }
}

export function startPumpDevListener(
  positions: PositionManager,
  priceProvider: PumpDevPriceProvider,
) {
  connect(positions, priceProvider);

  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      syncSubscriptions(positions);
    }
  }, 10000);
}

export function stopPumpDevListener() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedMints.clear();
  subscribedNewTokens = false;
}
