import { Subscription, interval } from "rxjs";
import { CONFIG } from "../config";
import { pumpdevNewToken$ } from "../pumpdev/listener";
import { pumpapiNewToken$ } from "../pumpapi/listener";
import { initialFilter } from "../filter/initial_filter";
import { tokenQualityFilter } from "../filter/token_quality_filter";
import { enqueueToken, dequeueOldest, peekOldest, queueSize, tokenQueued$ } from "./signal_queue";
import { getRugAnalysis, buildRugFromApi } from "../utils/rug_check";
import { getSolUsdRate } from "../utils/sol_usd";
import type { NewTokenEvent } from "./types";
import type { RugInfo } from "../utils/rug_check";

export interface ScoredToken {
  event: NewTokenEvent;
  qualityScore: number;
  rug?: RugInfo;
  compositeScore: number;
}

const MIN_COMPOSITE_SCORE = 50;

let pipelineSubs: Subscription[] = [];
let processTimer: ReturnType<typeof setInterval> | null = null;
let onExecute: ((token: ScoredToken) => Promise<void>) | null = null;

export function setExecuteHandler(handler: (token: ScoredToken) => Promise<void>) {
  onExecute = handler;
}

function handleNewToken(event: NewTokenEvent) {
  const filter = initialFilter(event);
  if (!filter.passed) {
    if (CONFIG.logLevel === "debug") {
      console.log(`[Pipeline] ${event.symbol} filtered: ${filter.reason}`);
    }
    return;
  }

  const quality = tokenQualityFilter(event);
  const normalized = Math.round((quality.score / quality.maxScore) * 100);

  if (normalized < 30) {
    if (CONFIG.logLevel === "debug") {
      console.log(`[Pipeline] ${event.symbol} quality too low: ${normalized}/100`);
    }
    return;
  }

  console.log(`[Pipeline] + ${event.symbol} (${event.mint.slice(0, 8)}…) quality=${normalized}%`);
  enqueueToken(event, quality);
}

function processNext() {
  if (queueSize() === 0) return;
  if (!onExecute) return;

  const entry = peekOldest();
  if (!entry) return;

  const { event, quality } = entry;

  getRugAnalysis(event.mint)
    .then((apiResult) => {
      const rug = buildRugFromApi(apiResult);
      const normalized = Math.round((quality.score / quality.maxScore) * 100);
      const rugScore = rug?.score ?? 0;
      const composite = Math.round((normalized + (100 - rugScore)) / 2);

      if (composite < MIN_COMPOSITE_SCORE) {
        console.log(`[Pipeline] ${event.symbol} composite ${composite} < ${MIN_COMPOSITE_SCORE}, skipping`);
        dequeueOldest();
        return;
      }

      const scored: ScoredToken = { event, qualityScore: normalized, rug, compositeScore: composite };
      console.log(`[Pipeline] Executing ${event.symbol} composite=${composite}%`);

      dequeueOldest();
      onExecute!(scored).catch((err) => {
        console.error(`[Pipeline] Execute error for ${event.symbol}:`, err);
      });
    })
    .catch((err) => {
      console.error(`[Pipeline] RugCheck error for ${event.mint}:`, err);
      dequeueOldest();
    });
}

export function startPipeline() {
  pipelineSubs.push(
    pumpdevNewToken$.subscribe((event) => handleNewToken(event)),
  );
  pipelineSubs.push(
    pumpapiNewToken$.subscribe((event) => handleNewToken(event)),
  );

  processTimer = setInterval(processNext, CONFIG.positionScanIntervalMs);
  console.log("[Pipeline] Started");
}

export function stopPipeline() {
  for (const sub of pipelineSubs) sub.unsubscribe();
  pipelineSubs = [];
  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }
  console.log("[Pipeline] Stopped");
}
