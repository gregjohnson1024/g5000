/**
 * Shared accessor for the g5000 app's per-source channel-history singleton.
 *
 * The history buffer is owned by `apps/g5000` (it installs a bus subscription
 * at boot and keeps a rolling, per-(channel, source) ring of raw samples). We
 * declare the cross-process interface and a `globalThis`-backed singleton here
 * so Next.js API routes living in the web package can resolve the same instance
 * without importing into the server package.
 *
 * It captures the undamped, per-source wind signals straight off the bus so a
 * diagnostic view can compare every source feeding each channel — e.g. the
 * three apparent-wind sources (raw masthead vs. H5000-CPU corrected) or the two
 * disagreeing magnetic-heading sources (Precision-9 vs. ZG100). Values are the
 * raw bus scalars in SI units (m/s, rad), un-EMA'd; `/api/stream` winner-selects
 * and damps and would hide the very jumpiness this is meant to surface.
 */

/** A single timestamped scalar sample (SI, as carried on the bus). */
export interface HistoryPoint {
  /** Sample time, ms since epoch (UTC). */
  tMs: number;
  /** Scalar value in SI units (m/s for speeds, rad for angles). */
  v: number;
}

/** A rolling buffer of points for one (channel, source) pair. */
export interface ChannelSeries {
  channel: string;
  source: string;
  points: HistoryPoint[];
}

export interface ChannelHistorySnapshot {
  /** Configured window length in ms covered by the returned series. */
  windowMs: number;
  /** One series per (channel, source) seen within the window. */
  series: ChannelSeries[];
}

export interface ChannelHistory {
  /**
   * Return the per-source series seen within the last `windowMs` ms, optionally
   * restricted to `channels`. Both arguments fall back to the owner's defaults.
   */
  snapshot(windowMs?: number, channels?: string[]): ChannelHistorySnapshot;
}

const GLOBAL_KEY = '__g5000_channel_history__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_channel_history__: ChannelHistory | undefined;
}

export function getSharedChannelHistory(): ChannelHistory | undefined {
  return globalThis[GLOBAL_KEY];
}

export function setSharedChannelHistory(h: ChannelHistory): void {
  globalThis[GLOBAL_KEY] = h;
}

export function _resetChannelHistoryForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
