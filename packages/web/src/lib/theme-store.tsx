'use client';

/**
 * theme-store.ts — shared theme + instrument-scale state exposed via React context.
 *
 * Motivaton: ThemeController owns the SSE subscription (boat-wide sync via
 * /api/mast/stream). NavShell's ThemeChip needs to reflect SSE-pushed themes
 * without polling independently. This module is the bridge: ThemeController
 * writes into the context; ThemeChip reads from it.
 *
 * Scale: --instrument-scale on <html> multiplies only d1–d4 display-numeral tiers
 * in InstrumentTile. Presets: 1.0 (phone) / 1.15 (Pi helm) / 1.6 (mast Chipsee).
 *
 * Usage:
 *   - Wrap the app with <ThemeStoreProvider> (layout.tsx, outside ThemeController).
 *   - ThemeController calls useThemeStore().setTheme / .applyScale on SSE pushes.
 *   - ThemeChip (NavShell) calls useThemeStore() to read theme + cycle.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Theme } from '@g5000/mast';
import { storageGet, storageSet } from './storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

/** Allowed preset scale values (must match route.ts VALID_SCALES). */
export const SCALE_PRESETS = [1.0, 1.15, 1.6] as const;
export type ScalePreset = (typeof SCALE_PRESETS)[number];

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function readStoredTheme(): Theme {
  const stored = storageGet('theme');
  return stored === 'night' || stored === 'sun' ? (stored as Theme) : 'day';
}

/**
 * Apply --instrument-scale CSS custom property to <html> so all d1–d4
 * calc() expressions pick it up without a React re-render.
 */
export function applyScale(scale: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--instrument-scale', String(scale));
  }
}

export function readStoredScale(): ScalePreset {
  const raw = storageGet('instrument-scale');
  const v = raw !== null ? Number(raw) : NaN;
  // Snap to nearest preset; default 1.0.
  return (SCALE_PRESETS as readonly number[]).includes(v) ? (v as ScalePreset) : 1.0;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ThemeStore {
  theme: Theme;
  /** Apply theme locally + persist + POST /api/mast/theme for boat-wide sync. */
  setTheme: (t: Theme) => void;
  /** Cycle DAY → NIGHT → SUN → DAY. */
  cycleTheme: () => void;
  scale: ScalePreset;
  /** Apply scale locally + persist + POST /api/mast/scale for boat-wide sync. */
  setScale: (s: ScalePreset) => void;
  /**
   * Apply an INBOUND (SSE-pushed) theme locally + persist, WITHOUT POSTing back.
   * Using setTheme here would POST → the server re-broadcasts → we receive it →
   * POST again … an echo loop. Inbound events must never re-POST.
   */
  receiveTheme: (t: Theme) => void;
  /** Apply an INBOUND (SSE-pushed) scale locally + persist, WITHOUT POSTing back. */
  receiveScale: (s: ScalePreset) => void;
}

const ThemeContext = createContext<ThemeStore | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeStoreProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readStoredTheme();
    // Apply immediately so the chip reflects what the pre-hydration inline
    // script already set on <html data-theme>.
    applyTheme(t);
    return t;
  });

  const [scale, setScaleState] = useState<ScalePreset>(() => {
    const s = readStoredScale();
    // Apply immediately so --instrument-scale is set before hydration completes.
    applyScale(s);
    return s;
  });

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
    storageSet('theme', t);
    setThemeState(t);
    fetch('/api/mast/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {});
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] as Theme;
      applyTheme(next);
      storageSet('theme', next);
      fetch('/api/mast/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const setScale = useCallback((s: ScalePreset) => {
    applyScale(s);
    storageSet('instrument-scale', String(s));
    setScaleState(s);
    fetch('/api/mast/scale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: s }),
    }).catch(() => {});
  }, []);

  // Inbound (SSE) appliers — apply + persist + update state, but NEVER POST.
  const receiveTheme = useCallback((t: Theme) => {
    applyTheme(t);
    storageSet('theme', t);
    setThemeState(t);
  }, []);

  const receiveScale = useCallback((s: ScalePreset) => {
    applyScale(s);
    storageSet('instrument-scale', String(s));
    setScaleState(s);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, cycleTheme, scale, setScale, receiveTheme, receiveScale }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useThemeStore(): ThemeStore {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeStore must be used inside <ThemeStoreProvider>');
  }
  return ctx;
}
