import { Subject } from "rxjs";
import { CONFIG } from "../config";
import type { NewTokenEvent } from "../pipeline/types";

const WS_URL = "wss://stream.pumpapi.io/";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export const pumpapiNewToken$ = new Subject<NewTokenEvent>();

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.error("[PumpAPI] Failed to create WebSocket:", err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("[PumpAPI] Connected to stream.pumpapi.io");
  };

  ws.onmessage = (raw) => {
    try {
      const event = JSON.parse(raw.data as string);
      if (event.action !== "create") return;
      if (event.pool !== "pump") return;

      const mintRevoked = event.mintAuthority === null || event.mintAuthority === undefined;
      const freezeRevoked = event.freezeAuthority === null || event.freezeAuthority === undefined;
      let burnedLiquidityPct: number | undefined;
      if (event.burnedLiquidity != null) {
        const parsed = parseInt(String(event.burnedLiquidity), 10);
        if (!isNaN(parsed)) burnedLiquidityPct = parsed;
      }

      pumpapiNewToken$.next({
        source: "pumpapi",
        mint: event.mint,
        name: event.name ?? "Unknown",
        symbol: event.symbol ?? "???",
        uri: event.uri,
        pool: event.pool,
        initialBuy: event.initialBuy,
        marketCapQuote: event.marketCapQuote,
        solAmount: event.quoteAmount,
        price: event.price,
        mintRevoked,
        freezeRevoked,
        poolFeeRate: event.poolFeeRate,
        mayhemMode: event.mayhemMode,
        cashbackEnabled: event.cashbackEnabled,
        burnedLiquidityPct,
        txSigner: event.txSigner,
        signature: event.signature,
        timestamp: event.timestamp ?? Date.now(),
      });
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => {
    console.log("[PumpAPI] Disconnected");
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error("[PumpAPI] Error:", err);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

export function startPumpAPIListener() {
  connect();
}

export function stopPumpAPIListener() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
