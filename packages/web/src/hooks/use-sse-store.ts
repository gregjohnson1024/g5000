'use client';

/**
 * use-sse-store — client hooks for the single shared SSE connection.
 *
 * Backed by the module-level store in `lib/sse-store.ts` via
 * `useSyncExternalStore`, so a consumer re-renders ONLY when the slice it
 * selects actually changes:
 *
 *   - useSseConnected()      → re-renders only when connectivity flips.
 *   - useSseChannel(channel) → re-renders only when THAT channel updates.
 *   - useSseStore()          → re-renders on every message (full store); avoid
 *                              in always-mounted components (e.g. NavShell).
 *
 * This replaced a React-Context provider whose value object changed on every
 * SSE message, which re-rendered every consumer (and the always-mounted shell)
 * at the full sample rate and made the UI unresponsive. See lib/sse-store.ts.
 */

import { useSyncExternalStore } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import {
  subscribe,
  getVersion,
  getConnected,
  getSample,
  getLastSampleAt,
  getChannels,
  getLastSampleAtMap,
} from '../lib/sse-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SseStoreContextValue {
  /** Latest sample per channel, keyed by channel name. */
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** True while the EventSource connection is open. */
  connected: boolean;
  /** Per-channel Unix-ms of the most recent received sample. */
  lastSampleAt: ReadonlyMap<string, number>;
}

export interface UseSseChannelResult {
  /** Latest sample for this channel, or null if none received yet. */
  sample: JsonSafeSample | null;
  /** True while the underlying EventSource connection is open. */
  connected: boolean;
  /** Unix-ms of the last received sample for this channel, or null. */
  lastSampleAt: number | null;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Connection state only. Re-renders the caller ONLY when the link opens or
 * closes — never on a data message. Use this for link LEDs / "LIVE·LOST"
 * indicators in always-mounted chrome.
 */
export function useSseConnected(): boolean {
  return useSyncExternalStore(subscribe, getConnected, () => false);
}

/**
 * Select a single channel from the shared SSE store. Re-renders the caller ONLY
 * when the selected channel's sample updates (or connectivity flips), because
 * each slice is its own `useSyncExternalStore` with an Object.is bail-out.
 */
export function useSseChannel(channel: string): UseSseChannelResult {
  const sample = useSyncExternalStore(
    subscribe,
    () => getSample(channel),
    () => null,
  );
  const connected = useSseConnected();
  const lastSampleAt = useSyncExternalStore(
    subscribe,
    () => getLastSampleAt(channel),
    () => null,
  );
  return { sample, connected, lastSampleAt };
}

/**
 * Full-store hook: all channels, connected state, and lastSampleAt. Re-renders
 * on EVERY message (subscribes to the version counter). Prefer useSseChannel /
 * useSseConnected; only use this when a component genuinely needs to iterate all
 * channels, and never in an always-mounted tree.
 */
export function useSseStore(): SseStoreContextValue {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return {
    channels: getChannels(),
    connected: getConnected(),
    lastSampleAt: getLastSampleAtMap(),
  };
}
