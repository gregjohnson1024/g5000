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
import { useThemeStore, applyScale, SCALE_PRESETS, type ScalePreset } from '../lib/theme-store';
import { storageSet } from '../lib/storage';

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export function ThemeController(): React.ReactNode {
  const { setTheme, setScale } = useThemeStore();

  // Open SSE stream to receive boat-wide theme + scale changes.
  useEffect(() => {
    const es = new EventSource('/api/mast/stream');

    es.addEventListener('theme', (ev) => {
      try {
        const t = JSON.parse((ev as MessageEvent).data) as string;
        if (THEMES.includes(t as Theme)) {
          const valid = t as Theme;
          // Use setTheme so the shared store + chip state both update.
          setTheme(valid);
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
            : (SCALE_PRESETS.reduce((prev, curr) =>
                Math.abs(curr - s) < Math.abs(prev - s) ? curr : prev,
              ) as ScalePreset);
          applyScale(preset);
          storageSet('instrument-scale', String(preset));
          setScale(preset);
        }
      } catch {
        /* ignore malformed payloads */
      }
    });

    return () => {
      es.close();
    };
  }, [setTheme, setScale]);

  // Renders nothing — UI chip lives in NavShell AppBar.
  return null;
}
