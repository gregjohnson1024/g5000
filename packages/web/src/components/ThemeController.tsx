'use client';

/**
 * ThemeController — boat-wide theme SSE sync.
 *
 * Responsibilities:
 * 1. On mount, opens EventSource on /api/mast/stream and listens for 'theme'
 *    events; applies data-theme + updates the shared ThemeStore so all
 *    consumers (AppBar ThemeChip, etc.) stay in sync.
 * 2. Renders nothing — the AppBar ThemeChip in NavShell is the UI.
 *
 * NOTE: Per-device theme override is handled by ThemeChip in NavShell (it
 * writes to localStorage + POSTs to the API). ThemeController is the inbound
 * SSE receiver only.
 *
 * The pre-hydration inline script in layout.tsx's <head> prevents the
 * default-day flash on load — this component must not override that initial
 * apply on mount, only on SSE pushes.
 */

import { useEffect } from 'react';
import type { Theme } from '@g5000/mast';
import { useThemeStore, applyTheme } from '../lib/theme-store';
import { storageSet } from '../lib/storage';

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export function ThemeController(): React.ReactNode {
  const { setTheme } = useThemeStore();

  // Open SSE stream to receive boat-wide theme changes.
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

    return () => {
      es.close();
    };
  }, [setTheme]);

  // Renders nothing — UI chip lives in NavShell AppBar.
  return null;
}
