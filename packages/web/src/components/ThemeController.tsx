'use client';

/**
 * ThemeController — app-wide theme persistence + boat-wide sync.
 *
 * Responsibilities:
 * 1. On mount, reads persisted theme from localStorage (g5000:theme) and
 *    applies it to <html data-theme>. Default is 'day'.
 * 2. Opens EventSource on /api/mast/stream and listens for 'theme' events —
 *    applies data-theme + persists locally so all browser tabs on the same
 *    vessel stay in sync (boat-wide sync via ConfigStore → SSE).
 * 3. Exposes setTheme(t): optimistic apply + persist + POST /api/mast/theme.
 * 4. Renders a minimal temporary 3-way chip (DAY / NIGHT / SUN) for
 *    testability during Phase 1. The full AppBar chip lands in Phase 2; remove
 *    or hide this once Phase 2 ships.
 *
 * NOTE: suncalc-based suggestion is deferred to Phase 2. This component never
 * auto-switches the theme (keep-list invariant: "system proposes, sailor disposes").
 */

import { useEffect, useState, useCallback } from 'react';
import type { Theme } from '@g5000/mast';
import { storageGet, storageSet } from '../lib/storage';

const THEMES: readonly Theme[] = ['day', 'night', 'sun'];

/** Apply data-theme to <html> without a React render cycle. */
function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function ThemeController(): React.ReactNode {
  // Read the persisted theme synchronously; default to 'day'.
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = storageGet('theme');
    return (stored === 'night' || stored === 'sun' ? stored : 'day') as Theme;
  });

  // Apply persisted theme on first render (avoids flash on subsequent loads).
  useEffect(() => {
    applyTheme(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once

  // Open SSE stream to receive boat-wide theme changes.
  useEffect(() => {
    const es = new EventSource('/api/mast/stream');

    es.addEventListener('theme', (ev) => {
      try {
        const t = JSON.parse((ev as MessageEvent).data) as string;
        if (THEMES.includes(t as Theme)) {
          const valid = t as Theme;
          applyTheme(valid);
          storageSet('theme', valid);
          setThemeState(valid);
        }
      } catch {
        /* ignore malformed payloads */
      }
    });

    return () => {
      es.close();
    };
  }, []);

  const setTheme = useCallback((t: Theme): void => {
    // Optimistic: apply immediately.
    applyTheme(t);
    storageSet('theme', t);
    setThemeState(t);

    // Persist to server (boat-wide sync).
    fetch('/api/mast/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {
      /* server unavailable — local state already applied */
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Temporary Phase-1 theme switcher chip (remove / replace in Phase 2).
  // Fixed bottom-right, above the z-stack so it's always reachable.
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '0.75rem',
        right: '0.75rem',
        zIndex: 9999,
        display: 'flex',
        gap: '2px',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '6px',
        padding: '3px',
        fontFamily: 'monospace',
        fontSize: '11px',
      }}
      aria-label="Theme switcher (Phase 1 temporary)"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          aria-pressed={theme === t}
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            background: theme === t ? '#d97706' : 'transparent',
            color: theme === t ? '#000' : '#aaa',
            fontFamily: 'monospace',
            fontSize: '11px',
            textTransform: 'uppercase',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
