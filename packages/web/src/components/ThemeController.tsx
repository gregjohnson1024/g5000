'use client';

/**
 * ThemeController — boat-wide theme + instrument-scale SSE sync.
 *
 * Responsibilities:
 * 1. On mount, opens EventSource on /api/mast/stream and listens for 'theme'
 *    events; applies data-theme + updates the shared ThemeStore so all
 *    consumers (AppBar ThemeChip, etc.) stay in sync.
 * 2. Listens for 'scale' events; applies --instrument-scale on <html> and
 *    updates the shared ThemeStore so the displays/scale control reflects the
 *    boat-wide setting.
 * 3. Renders nothing — the AppBar ThemeChip in NavShell is the UI.
 *
 * NOTE: Per-device theme/scale override is handled by ThemeChip in NavShell
 * (writes to localStorage + POSTs to the API). ThemeController is the inbound
 * SSE receiver only.
 *
 * The pre-hydration inline script in layout.tsx's <head> prevents the
 * default-day flash and default-scale shift on cold load.
 */

import { useEffect } from 'react';
import type { Theme } from '@g5000/mast';
import { useThemeStore, SCALE_PRESETS, type ScalePreset } from '../lib/theme-store';

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export function ThemeController(): React.ReactNode {
  // Receive-only appliers: applying an inbound SSE theme/scale must NOT POST
  // back, or the server re-broadcasts it and we echo-loop (a ~333 req/s storm
  // that froze the whole UI). setTheme/setScale (which POST) are for the chip's
  // user-initiated changes only.
  const { receiveTheme, receiveScale } = useThemeStore();

  // Open SSE stream to receive boat-wide theme + scale changes.
  useEffect(() => {
    const es = new EventSource('/api/mast/stream');

    es.addEventListener('theme', (ev) => {
      try {
        const t = JSON.parse((ev as MessageEvent).data) as string;
        if (THEMES.includes(t as Theme)) {
          // Apply locally only — do NOT POST back (echo-loop guard).
          receiveTheme(t as Theme);
        }
      } catch {
        /* ignore malformed payloads */
      }
    });

    es.addEventListener('scale', (ev) => {
      try {
        const s = JSON.parse((ev as MessageEvent).data) as number;
        if (typeof s === 'number' && isFinite(s)) {
          // Snap to nearest preset.
          const preset = (SCALE_PRESETS as readonly number[]).includes(s)
            ? (s as ScalePreset)
            : (SCALE_PRESETS.reduce((prev: ScalePreset, curr: ScalePreset) =>
                Math.abs(curr - s) < Math.abs(prev - s) ? curr : prev,
              ) as ScalePreset);
          // Apply locally only — do NOT POST back (echo-loop guard).
          receiveScale(preset);
        }
      } catch {
        /* ignore malformed payloads */
      }
    });

    return () => {
      es.close();
    };
  }, [receiveTheme, receiveScale]);

  // Renders nothing — UI chip lives in NavShell AppBar.
  return null;
}
