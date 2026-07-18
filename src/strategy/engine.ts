import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  interval,
  merge,
} from "rxjs";

import { filter, map, takeUntil, tap } from "rxjs/operators";

import { CONFIG } from "../config";
import { log } from "../utils/logger";

import type { PriceInfo } from "./types";

import { updatePositionPrice } from "./store";

import { scanPositions } from "./scanner";

// ============================================================================
// Types
// ============================================================================

export type PositionEngineState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping";

// ============================================================================
// Reactive Events
// ============================================================================

/**
 * Current engine state.
 */
export const positionEngineState$ = new BehaviorSubject<PositionEngineState>(
  "stopped",
);

/**
 * Emits every processed market update.
 *
 * Mainly useful for dashboards and debugging.
 */
export const positionProcessed$ = new Subject<PriceInfo>();

// ============================================================================
// Position Engine
// ============================================================================

/**
 * Coordinates the entire position management pipeline.
 *
 * Responsibilities:
 *
 * • receive price updates
 * • update open positions
 * • periodically scan strategies
 * • expose lifecycle state
 *
 * The engine intentionally does NOT:
 *
 * • execute trades
 * • calculate account balance
 * • contain strategy logic
 */
export class PositionEngine {
  private readonly stop$ = new Subject<void>();

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly price$: Observable<PriceInfo>,
    private readonly scanInterval = CONFIG.positionScanIntervalMs,
  ) {}

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Starts the position engine.
   *
   * Once started the engine:
   *
   * • listens for market price updates
   * • updates open positions
   * • periodically evaluates exit strategies
   */
  start(): void {
    if (positionEngineState$.value === "running") {
      return;
    }

    positionEngineState$.next("starting");

    // --------------------------------------------------------------------------
    // Price Stream
    // --------------------------------------------------------------------------

    this.subscriptions.add(
      this.price$
        .pipe(
          takeUntil(this.stop$),

          filter(
            (update) => Number.isFinite(update.priceUsd) && update.priceUsd > 0,
          ),

          tap((update) => {
            updatePositionPrice(update);

            positionProcessed$.next(update);
          }),
        )
        .subscribe(),
    );

    // --------------------------------------------------------------------------
    // Strategy Scanner
    // --------------------------------------------------------------------------

    this.subscriptions.add(
      interval(this.scanInterval)
        .pipe(
          takeUntil(this.stop$),

          tap(() => {
            scanPositions(Date.now());
          }),
        )
        .subscribe(),
    );

    positionEngineState$.next("running");

    log.info("engine", `Started (${this.scanInterval} ms scan interval)`);
  }

  /**
   * Stops the engine.
   */
  stop(): void {
    if (positionEngineState$.value === "stopped") {
      return;
    }

    positionEngineState$.next("stopping");

    this.stop$.next();

    this.subscriptions.unsubscribe();

    positionEngineState$.next("stopped");

    log.info("engine", "Stopped");
  }
  // ============================================================================
  // Internal Streams
  // ============================================================================

  /**
   * Creates the unified event loop.
   *
   * All engine activities flow through a single RxJS pipeline.
   */
  private createEngine$(): Observable<void> {
    const priceEvents$ = this.price$.pipe(
      filter(
        (update) => Number.isFinite(update.priceUsd) && update.priceUsd > 0,
      ),

      tap((update) => {
        updatePositionPrice(update);

        positionProcessed$.next(update);
      }),

      map(() => undefined),
    );

    const scanner$ = interval(this.scanInterval).pipe(
      tap(() => {
        scanPositions(Date.now());
      }),

      map(() => undefined),
    );

    return merge(priceEvents$, scanner$).pipe(takeUntil(this.stop$));
  }
}
