'use client';

/**
 * use-sse-store — client hook for consuming the single shared SSE connection.
 *
 * Exposes the full store (all channels) or, via the channel-selector
 * overload, a single channel's latest sample + connected state.
 *
 * Usage:
 *
 *   // Full store — caller can read any channel.
 *   const { channels, connected, lastSampleAt } = useSseStore();
 *   const sample = channels.get('wind.true.angle');
 *
 *   // Channel selector — re-renders only when the selected channel updates.
 *   const { sample, connected } = useSseChannel('wind.true.angle');
 *
 * Phase-0 note: only the provider is mounted in Phase 0. Existing useSse()
 * consumers are NOT cut over yet — that happens when each screen is rebuilt.
 */

import { useContext } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import { SseStoreContext } from '../components/SseStoreProvider';

// ---------------------------------------------------------------------------
// Full-store hook
// ---------------------------------------------------------------------------

export { type SseStoreContextValue } from '../components/SseStoreProvider';

/**
 * Returns the full SSE store value: all channels, connected state, and per-
 * channel lastSampleAt timestamps. Use when a component needs multiple channels
 * or needs to iterate over available channels.
 */
export function useSseStore() {
  return useContext(SseStoreContext);
}

// ---------------------------------------------------------------------------
// Per-channel selector hook
// ---------------------------------------------------------------------------

export interface UseSseChannelResult {
  /** Latest sample for this channel, or null if none received yet. */
  sample: JsonSafeSample | null;
  /** True while the underlying EventSource connection is open. */
  connected: boolean;
  /**
   * Unix-ms timestamp of the last received sample for this channel, or null
   * if no sample has been received. Useful for staleness checks.
   */
  lastSampleAt: number | null;
}

/**
 * Select a single channel from the shared SSE store.
 *
 * Re-renders the consumer whenever the selected channel's sample updates
 * (React re-renders the whole context on any channel change, so this hook
 * does NOT add extra filtering — it is a convenience wrapper that extracts
 * the channel-specific values for the caller).
 *
 * For a future optimisation (channel-level selectors that skip re-renders when
 * unrelated channels update), replace the useContext call with useMemo or
 * migrate to Zustand / Jotai in a later phase.
 */
export function useSseChannel(channel: string): UseSseChannelResult {
  const { channels, connected, lastSampleAt } = useContext(SseStoreContext);
  return {
    sample: channels.get(channel) ?? null,
    connected,
    lastSampleAt: lastSampleAt.get(channel) ?? null,
  };
}
