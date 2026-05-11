/**
 * Shared accessor for the autopilot-server's observed-sources tracker.
 *
 * The tracker itself is owned by `apps/autopilot-server` (it installs a bus
 * subscription at boot). We declare the cross-process interface and a
 * `globalThis`-backed singleton here so Next.js API routes living in the web
 * package can resolve the same instance without importing into the server
 * package.
 */

export interface ObservedSourceEntry {
  channel: string;
  source: string;
  /** Last-seen sample time, nanoseconds since epoch. */
  lastSeenT_ns: bigint;
  /** Convenience: last-seen time in ms since epoch. */
  lastSeenMs: number;
  /** Convenience: age (ms) at the time of the read. */
  ageMs: number;
}

export interface ObservedSources {
  /**
   * Return entries seen within the last `windowMs` ms. Default 5000.
   * Stable order: channel asc, then source asc.
   */
  recent(windowMs?: number): ObservedSourceEntry[];
}

const GLOBAL_KEY = '__g5000_observedSources__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_observedSources__: ObservedSources | undefined;
}

export function getSharedObservedSources(): ObservedSources | undefined {
  return globalThis[GLOBAL_KEY];
}

export function setSharedObservedSources(t: ObservedSources): void {
  globalThis[GLOBAL_KEY] = t;
}

export function _resetSharedObservedSourcesForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
