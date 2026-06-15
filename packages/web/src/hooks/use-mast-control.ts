'use client';

import { useEffect, useState } from 'react';
import type { DayBaseColor, MastLayout } from '@g5000/mast';

export interface UseMastControlResult {
  layout: MastLayout | null;
  override: string | null;
  connected: boolean;
  nightMode: boolean;
  dayBaseColor: DayBaseColor;
}

/**
 * Subscribe to `/api/mast/stream` for the lifetime of the component. Returns
 * the latest `MastLayout` and active override slot (if any). Uses named SSE
 * events (`layout` and `override`) rather than the default `message` event.
 */
export function useMastControl(): UseMastControlResult {
  const [layout, setLayout] = useState<MastLayout | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [nightMode, setNightMode] = useState(false);
  const [dayBaseColor, setDayBaseColor] = useState<DayBaseColor>('white');

  useEffect(() => {
    const es = new EventSource('/api/mast/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
    };
    es.addEventListener('layout', (ev) => {
      try {
        setLayout(JSON.parse((ev as MessageEvent).data) as MastLayout);
      } catch {
        /* ignore malformed payloads */
      }
    });
    es.addEventListener('override', (ev) => {
      try {
        setOverride(JSON.parse((ev as MessageEvent).data) as string | null);
      } catch {
        /* ignore malformed payloads */
      }
    });
    es.addEventListener('nightmode', (ev) => {
      try {
        setNightMode(JSON.parse((ev as MessageEvent).data) as boolean);
      } catch {
        /* ignore malformed payloads */
      }
    });
    es.addEventListener('daybasecolor', (ev) => {
      try {
        setDayBaseColor(JSON.parse((ev as MessageEvent).data) as DayBaseColor);
      } catch {
        /* ignore malformed payloads */
      }
    });
    return () => {
      es.close();
    };
  }, []);

  return { layout, override, connected, nightMode, dayBaseColor };
}
