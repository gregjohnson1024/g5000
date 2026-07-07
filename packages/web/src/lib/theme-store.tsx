'use client';

/**
 * theme-store.ts — shared theme state + setTheme exposed via React context.
 *
 * Motivaton: ThemeController owns the SSE subscription (boat-wide sync via
 * /api/mast/stream). NavShell's ThemeChip needs to reflect SSE-pushed themes
 * without polling independently. This module is the bridge: ThemeController
 * writes into the context; ThemeChip reads from it.
 *
 * Usage:
 *   - Wrap the app with <ThemeStoreProvider> (layout.tsx, outside ThemeController).
 *   - ThemeController calls useThemeStore().setTheme on every SSE push.
 *   - ThemeChip (NavShell) calls useThemeStore() to read theme + cycle.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Theme } from '@g5000/mast';
import { storageGet, storageSet } from './storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function readStoredTheme(): Theme {
  const stored = storageGet('theme');
  return stored === 'night' || stored === 'sun' ? (stored as Theme) : 'day';
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

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
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
