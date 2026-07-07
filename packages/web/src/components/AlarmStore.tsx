'use client';

/**
 * AlarmStore — ONE shared alarm source for the entire app.
 *
 * Wraps a single usePoll<{ active: AlarmRow[] }>('/api/alarms', 2000) and
 * exposes the derived alarm state via useAlarms(). Every consumer (NavShell
 * AlarmLane + bell, AlarmAudio, AlarmBanner) reads from this context —
 * exactly one /api/alarms poll app-wide.
 *
 * Severity ranking defined ONCE here:
 *   CRITICAL = 3  |  WARN = 2  |  INFO = 1
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePoll } from '../hooks/use-poll';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
}

export const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARN: 2, INFO: 1 };

export type TopSeverity = 'CRITICAL' | 'WARN' | 'INFO' | null;

export interface AlarmState {
  /** All active alarms, sorted highest-severity first. */
  active: AlarmRow[];
  /** Highest severity among active alarms, or null if none. */
  topSeverity: TopSeverity;
  /** Count of active alarms. */
  count: number;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AlarmContext = createContext<AlarmState>({
  active: [],
  topSeverity: null,
  count: 0,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AlarmStore({ children }: { children: ReactNode }) {
  const { data } = usePoll<{ active?: AlarmRow[] }>('/api/alarms', 2000);

  const state = useMemo<AlarmState>(() => {
    const raw = data?.active ?? [];
    const active = [...raw].sort(
      (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
    );
    const topSeverity = active.length > 0 ? (active[0]!.severity as TopSeverity) : null;
    return { active, topSeverity, count: active.length };
  }, [data]);

  return <AlarmContext.Provider value={state}>{children}</AlarmContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAlarms() — consume the shared alarm state.
 * Must be called inside a component tree that has <AlarmStore> as an ancestor.
 */
export function useAlarms(): AlarmState {
  return useContext(AlarmContext);
}
