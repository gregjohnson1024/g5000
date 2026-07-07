'use client';

/**
 * SseStoreProvider — owns ONE EventSource('/api/stream') for the whole app.
 *
 * Generalises the per-component useSse() hook pattern. Instead of nine
 * separate EventSource connections (one per component that calls useSse),
 * the app has exactly one persistent connection managed here.
 *
 * Context shape:
 *  - channels: ReadonlyMap<string, JsonSafeSample>
 *      Latest sample received per channel. Updated on every SSE event.
 *  - connected: boolean
 *      True once the EventSource's onopen fires; false while connecting or
 *      after an error.
 *  - lastSampleAt: ReadonlyMap<string, number>
 *      Per-channel Unix-ms timestamp of the most recent sample (identical to
 *      sample.t_ms for now, surfaced separately for StalenessShroud consumers).
 *
 * Phase-0 note: the provider is MOUNTED but no existing consumer has been cut
 * over yet. The nine existing useSse() call sites continue to create their own
 * EventSource until their screens are rebuilt in later phases.
 *
 * Server note: this file is 'use client' so the provider only runs in the
 * browser. The context default value is used during SSR where EventSource is
 * unavailable.
 */

import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JsonSafeSample } from '@g5000/core';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface SseStoreContextValue {
  /** Latest sample per channel, keyed by channel name. */
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** True while the EventSource connection is open. */
  connected: boolean;
  /** Per-channel Unix-ms of the most recent received sample. */
  lastSampleAt: ReadonlyMap<string, number>;
}

const DEFAULT_VALUE: SseStoreContextValue = {
  channels: new Map(),
  connected: false,
  lastSampleAt: new Map(),
};

export const SseStoreContext = createContext<SseStoreContextValue>(DEFAULT_VALUE);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Mount once in the root layout. Opens a single EventSource('/api/stream')
 * and exposes its state to the entire subtree.
 */
export function SseStoreProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Map<string, JsonSafeSample>>(new Map());
  const [connected, setConnected] = useState(false);
  const [lastSampleAt, setLastSampleAt] = useState<Map<string, number>>(new Map());

  // Stable ref so we can close the previous ES on remount (StrictMode double-
  // invoke) without capturing a stale closure.
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Guard: EventSource is browser-only (should always be true inside
    // 'use client', but be defensive).
    if (typeof EventSource === 'undefined') return;

    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (ev) => {
      try {
        const { channel, sample } = JSON.parse(ev.data) as {
          channel: string;
          sample: JsonSafeSample;
        };
        setChannels((prev) => {
          const next = new Map(prev);
          next.set(channel, sample);
          return next;
        });
        setLastSampleAt((prev) => {
          const next = new Map(prev);
          next.set(channel, sample.t_ms);
          return next;
        });
      } catch {
        /* ignore malformed payloads */
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []); // intentionally empty — one ES for the lifetime of the app

  return (
    <SseStoreContext value={{ channels, connected, lastSampleAt }}>{children}</SseStoreContext>
  );
}
