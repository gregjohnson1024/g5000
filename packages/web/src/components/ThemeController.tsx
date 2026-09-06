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
import type { ClockConfig, Theme } from '@g5000/mast';
import { useThemeStore, SCALE_PRESETS, type ScalePreset } from '../lib/theme-store';
import { openReconnectingSse } from '../lib/reconnecting-sse';

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export function ThemeController(): React.ReactNode {
  // Receive-only appliers: applying an inbound SSE theme/scale must NOT POST
  // back, or the server re-broadcasts it and we echo-loop (a ~333 req/s storm
  // that froze the whole UI). setTheme/setScale (which POST) are for the chip's
  // user-initiated changes only.
  const { receiveTheme, receiveScale, receiveClockCfg } = useThemeStore();

  // Open SSE stream to receive boat-wide theme + scale changes.
  useEffect(() => {
    // Reconnecting: a g5000 restart must not strand long-lived pages (notably
    // the mast kiosk) on a dead stream, silently ignoring theme changes.
    return openReconnectingSse('/api/mast/stream', {
      listeners: {
        theme: (ev) => {
          try {
            const t = JSON.parse(ev.data) as string;
            if (THEMES.includes(t as Theme)) {
              // Apply locally only — do NOT POST back (echo-loop guard).
              receiveTheme(t as Theme);
            }
          } catch {
            /* ignore malformed payloads */
          }
        },

        scale: (ev) => {
          try {
            const s = JSON.parse(ev.data) as number;
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
        },

        clock: (ev) => {
          try {
            const c = JSON.parse(ev.data) as Partial<ClockConfig>;
            if (
              (c.mode === 'utc' || c.mode === 'ship') &&
              (c.offsetMin === null || typeof c.offsetMin === 'number')
            ) {
              // Apply locally only — do NOT POST back (echo-loop guard).
              receiveClockCfg({ mode: c.mode, offsetMin: c.offsetMin ?? null });
            }
          } catch {
            /* ignore malformed payloads */
          }
        },
      },
    });
  }, [receiveTheme, receiveScale, receiveClockCfg]);

  // Renders nothing — UI chip lives in NavShell AppBar.
  return null;
}
