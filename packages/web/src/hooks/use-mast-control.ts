'use client';

import { useEffect, useState } from 'react';
import type { DayBaseColor, MastLayout } from '@g5000/mast';
import { openReconnectingSse } from '../lib/reconnecting-sse';

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
    // Reconnecting: the mast panel is a kiosk that stays open for weeks, so a
    // g5000 restart must not leave it rendering stale state forever.
    return openReconnectingSse('/api/mast/stream', {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      listeners: {
        layout: (ev) => {
          try {
            setLayout(JSON.parse(ev.data) as MastLayout);
          } catch {
            /* ignore malformed payloads */
          }
        },
        override: (ev) => {
          try {
            setOverride(JSON.parse(ev.data) as string | null);
          } catch {
            /* ignore malformed payloads */
          }
        },
        nightmode: (ev) => {
          try {
            setNightMode(JSON.parse(ev.data) as boolean);
          } catch {
            /* ignore malformed payloads */
          }
        },
        daybasecolor: (ev) => {
          try {
            setDayBaseColor(JSON.parse(ev.data) as DayBaseColor);
          } catch {
            /* ignore malformed payloads */
          }
        },
      },
    });
  }, []);

  return { layout, override, connected, nightMode, dayBaseColor };
}
