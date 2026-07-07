'use client';

/**
 * sse-store — a single, module-level external store backing the app-wide
 * SSE connection, designed for `useSyncExternalStore` so consumers re-render
 * ONLY when the specific slice they select changes.
 *
 * Why this exists (perf-critical): the previous SseStoreProvider held the
 * channel maps in React state and republished a fresh context value object on
 * every SSE message. On a live boat, samples arrive many times per second
 * (GPS/heading ~10 Hz + wind + depth + AIS…), so every consumer — including the
 * always-mounted NavShell (its LinkLED reads only `connected`, and useBoatState
 * reads only `nav.gps.sog`) — re-rendered the whole shell on every message,
 * plus an O(channels) `new Map(prev)` copy per message. That pegged the browser
 * main thread and made the UI unresponsive.
 *
 * This store instead mutates two maps in place and bumps a version counter, and
 * exposes narrow getters. `useSyncExternalStore(subscribe, getSlice)` bails out
 * via Object.is when a consumer's selected slice is unchanged, so LinkLED
 * re-renders only when connectivity flips and a channel consumer re-renders only
 * when that channel updates. Full-store consumers can still subscribe to the
 * version and re-render every message (rare; avoid in always-mounted trees).
 *
 * The module is `'use client'`, so the singleton (maps, EventSource, listeners)
 * is per-browser-tab — exactly one EventSource for the app lifetime, ref-counted
 * so React StrictMode's mount/unmount/remount does not leak connections.
 */

import type { JsonSafeSample } from '@g5000/core';

interface SseSnapshot {
  channels: Map<string, JsonSafeSample>;
  lastSampleAt: Map<string, number>;
  connected: boolean;
}

const snap: SseSnapshot = {
  channels: new Map(),
  lastSampleAt: new Map(),
  connected: false,
};

const listeners = new Set<() => void>();
let version = 0;
let es: EventSource | null = null;
let refCount = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

/** Subscribe to any store change. Returns an unsubscribe fn. */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// ── Slice getters (stable-reference friendly for useSyncExternalStore) ────────

/** Monotonic counter that changes on every message — for full-store consumers. */
export function getVersion(): number {
  return version;
}

export function getConnected(): boolean {
  return snap.connected;
}

/** Latest sample for a channel (stable ref until that channel next updates). */
export function getSample(channel: string): JsonSafeSample | null {
  return snap.channels.get(channel) ?? null;
}

/** Unix-ms of the last sample for a channel. */
export function getLastSampleAt(channel: string): number | null {
  return snap.lastSampleAt.get(channel) ?? null;
}

/** Live channels map (same reference for the app lifetime — mutated in place). */
export function getChannels(): ReadonlyMap<string, JsonSafeSample> {
  return snap.channels;
}

/** Live lastSampleAt map (same reference for the app lifetime). */
export function getLastSampleAtMap(): ReadonlyMap<string, number> {
  return snap.lastSampleAt;
}

// ── Connection lifecycle (ref-counted; one EventSource for the app) ───────────

/**
 * Open the shared EventSource if not already open, and increment the ref count.
 * Returns a disconnect fn that decrements the count and closes the connection
 * when the last subscriber (the provider) unmounts.
 */
export function connect(): () => void {
  refCount += 1;

  if (!es && typeof EventSource !== 'undefined') {
    es = new EventSource('/api/stream');

    es.onopen = () => {
      if (!snap.connected) {
        snap.connected = true;
        emit();
      }
    };

    es.onmessage = (ev) => {
      try {
        const { channel, sample } = JSON.parse(ev.data) as {
          channel: string;
          sample: JsonSafeSample;
        };
        // Mutate in place — no O(n) map copy per message. The per-channel sample
        // object is replaced, so a consumer selecting getSample(channel) sees a
        // new reference (and re-renders) only when THAT channel updates.
        snap.channels.set(channel, sample);
        snap.lastSampleAt.set(channel, sample.t_ms);
        emit();
      } catch {
        /* ignore malformed payloads */
      }
    };

    es.onerror = () => {
      if (snap.connected) {
        snap.connected = false;
        emit();
      }
    };
  }

  return () => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      if (es) {
        es.close();
        es = null;
      }
    }
  };
}
