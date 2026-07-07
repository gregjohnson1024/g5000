'use client';

/**
 * use-boat-state.ts — Boat-state suggestion hook (Task 5, Phase 2).
 *
 * Returns { sail, anchor, voyage } boolean flags that drive suggestion dots on
 * NavShell section chips. Signals:
 *
 *   SAIL    — race timer is armed (timer.state !== 'idle'), polled from
 *             /api/race/state every 5 s
 *             OR SOG > 2.5 kt sustained for ~90 s derived from the SSE channel
 *             nav.gps.sog (checked via a 90-sample rolling window at ~1 Hz).
 *
 *   VOYAGE  — chart:planState.routes is non-empty, read from localStorage and
 *             refreshed on the storage event so it stays in sync across tabs.
 *
 *   ANCHOR  — anchor watch is armed, polled from /api/alarms/anchor every 10 s.
 *
 * Design rules (from the keep-list and proposal §5/§6):
 *   - NEVER auto-navigates.  NEVER changes the theme.
 *   - Race-state endpoint may return 503 when RaceState is unavailable (e.g.
 *     demo mode); treat that as "not armed" rather than an error.
 *   - SOG debounce: only set sail=true once SOG has been > 2.5 kt for at
 *     least SOG_SUSTAINED_TICKS consecutive 1-Hz samples from the SSE store.
 *     Resets to false once SOG falls below 2.5 kt for 1 tick.
 *   - All three signals start as false (no flash on initial hydration).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSseChannel } from '../hooks/use-sse-store';
import { usePoll } from '../hooks/use-poll';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** m/s equivalent of 2.5 kt (the underway threshold). */
const SOG_THRESHOLD_MS = 2.5 * 0.514444;

/**
 * Number of consecutive 1-Hz SSE ticks above the SOG threshold before "SAIL"
 * lights up (~90 s as specified).
 */
const SOG_SUSTAINED_TICKS = 90;

/** Poll interval for /api/race/state (ms). */
const RACE_POLL_MS = 5_000;

/** Poll interval for /api/alarms/anchor (ms). */
const ANCHOR_POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoatStateFlags {
  /** True when race timer is armed (pre-start or started) OR SOG > 2.5kt sustained. */
  sail: boolean;
  /** True when anchor-watch is armed. */
  anchor: boolean;
  /** True when chart:planState.routes is non-empty. */
  voyage: boolean;
}

interface RaceStateResponse {
  timer?: { state?: string };
}

interface AnchorAlarmResponse {
  ok?: boolean;
  anchor?: { armed?: boolean };
}

// ---------------------------------------------------------------------------
// VOYAGE: read chart:planState from localStorage
// ---------------------------------------------------------------------------

/**
 * Reads the raw (legacy) key `chart:planState` directly from localStorage.
 * The chart page writes to the raw key; migrateLegacyStorage() also populates
 * the namespaced `g5000:chart:planState`. We check both to be robust.
 */
function readVoyageFlag(): boolean {
  if (typeof window === 'undefined') return false;
  // Try namespaced key first (post-migration), then raw key.
  const raw =
    window.localStorage.getItem('g5000:chart:planState') ??
    window.localStorage.getItem('chart:planState');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { routes?: Record<string, unknown> };
    return typeof parsed.routes === 'object' && parsed.routes !== null
      ? Object.keys(parsed.routes).length > 0
      : false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns { sail, anchor, voyage } boat-state suggestion flags.
 *
 * All flags start false; they are updated by their respective sources
 * after the first data arrives (no loading flash).
 */
export function useBoatState(): BoatStateFlags {
  // ── SAIL (SOG leg) ───────────────────────────────────────────────────────
  // Narrow selector: this hook (and therefore the always-mounted NavShell) now
  // re-renders only when the SOG sample updates — NOT on every SSE message.
  const { sample: sog } = useSseChannel('nav.gps.sog');
  const sogTicksRef = useRef(0);
  const [sogSail, setSogSail] = useState(false);

  useEffect(() => {
    if (!sog || sog.value.kind !== 'scalar') return;
    const sogMs = sog.value.value;
    if (sogMs > SOG_THRESHOLD_MS) {
      sogTicksRef.current += 1;
      if (sogTicksRef.current >= SOG_SUSTAINED_TICKS) {
        setSogSail(true);
      }
    } else {
      sogTicksRef.current = 0;
      setSogSail(false);
    }
  }, [sog]);

  // ── SAIL (race timer leg) ─────────────────────────────────────────────────
  const { data: raceData } = usePoll<RaceStateResponse>('/api/race/state', RACE_POLL_MS);
  const raceArmed =
    raceData?.timer?.state !== undefined &&
    raceData.timer.state !== 'idle' &&
    raceData.timer.state !== 'finished';

  const sail = sogSail || raceArmed;

  // ── ANCHOR ────────────────────────────────────────────────────────────────
  const { data: anchorData } = usePoll<AnchorAlarmResponse>('/api/alarms/anchor', ANCHOR_POLL_MS);
  const anchor = anchorData?.anchor?.armed === true;

  // ── VOYAGE ────────────────────────────────────────────────────────────────
  const [voyage, setVoyage] = useState<boolean>(() => {
    // Safely initialise during SSR (returns false).
    if (typeof window === 'undefined') return false;
    return readVoyageFlag();
  });

  const refreshVoyage = useCallback(() => {
    setVoyage(readVoyageFlag());
  }, []);

  useEffect(() => {
    // Initial read (in case useState initialiser ran on the server).
    refreshVoyage();

    // React to writes from the chart page (same tab: storageEvent fires only
    // for OTHER tabs; chart page mutates localStorage directly, so we also poll
    // periodically for same-tab updates).
    window.addEventListener('storage', refreshVoyage);

    // Polling fallback for same-tab writes (chart page doesn't fire the storage
    // event). 2-second cadence is cheap and imperceptible.
    const id = setInterval(refreshVoyage, 2_000);
    return () => {
      window.removeEventListener('storage', refreshVoyage);
      clearInterval(id);
    };
  }, [refreshVoyage]);

  return { sail, anchor, voyage };
}
