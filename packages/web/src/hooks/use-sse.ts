'use client';

import { useEffect, useState } from 'react';
import type { JsonSafeSample } from '@h6000/core';

export interface UseSseResult {
  /** Latest sample per channel. Updated as SSE events arrive. */
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** True after the EventSource has confirmed connection. */
  connected: boolean;
}

/**
 * Subscribe to `/api/stream` for the lifetime of the component. Returns a
 * Map keyed by channel name with the latest sample. Component re-renders
 * on every new event (small payloads, batched server-side).
 */
export function useSse(): UseSseResult {
  const [channels, setChannels] = useState<Map<string, JsonSafeSample>>(
    new Map(),
  );
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');
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
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.onerror = () => {
      setConnected(false);
    };
    return () => {
      es.close();
    };
  }, []);

  return { channels, connected };
}
