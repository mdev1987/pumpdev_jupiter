import { BehaviorSubject, Subject } from "rxjs";
import { CONFIG } from "../config";
import type { NewTokenEvent, QualityScore } from "./types";

export interface QueuedToken {
  event: NewTokenEvent;
  quality: QualityScore;
  timestamp: number;
}

const signalQueue = new Map<string, QueuedToken>();

export const queueState$ = new BehaviorSubject<readonly QueuedToken[]>([]);
export const tokenQueued$ = new Subject<QueuedToken>();
export const tokenDequeued$ = new Subject<QueuedToken>();

function key(event: NewTokenEvent): string {
  return event.mint;
}

export function enqueueToken(event: NewTokenEvent, quality: QualityScore): boolean {
  const k = key(event);

  if (signalQueue.has(k)) {
    signalQueue.set(k, { event, quality, timestamp: Date.now() });
    queueState$.next([...signalQueue.values()]);
    return true;
  }

  evictExpired();
  if (signalQueue.size >= CONFIG.signalQueueMaxSize) {
    dequeueOldest();
  }

  const entry: QueuedToken = { event, quality, timestamp: Date.now() };
  signalQueue.set(k, entry);
  queueState$.next([...signalQueue.values()]);
  tokenQueued$.next(entry);
  return true;
}

export function dequeueOldest(): QueuedToken | null {
  const first = signalQueue.entries().next();
  if (first.done) return null;
  const [mint, entry] = first.value;
  signalQueue.delete(mint);
  queueState$.next([...signalQueue.values()]);
  tokenDequeued$.next(entry);
  return entry;
}

export function peekOldest(): QueuedToken | null {
  const first = signalQueue.values().next();
  return first.done ? null : first.value;
}

export function removeToken(mint: string): boolean {
  const entry = signalQueue.get(mint);
  if (!entry) return false;
  signalQueue.delete(mint);
  queueState$.next([...signalQueue.values()]);
  return true;
}

export function clearQueue(): void {
  signalQueue.clear();
  queueState$.next([]);
}

export function queueSize(): number {
  return signalQueue.size;
}

function evictExpired() {
  const now = Date.now();
  const ttl = CONFIG.signalQueueTtlMs;
  for (const [mint, entry] of signalQueue) {
    if (now - entry.timestamp > ttl) {
      signalQueue.delete(mint);
    }
  }
}
