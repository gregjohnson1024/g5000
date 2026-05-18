/**
 * Race-day shared state: countdown timer, start-line endpoints, active mark.
 *
 * In-memory mutable object with a subscribe/publish surface. Persistence
 * is the caller's responsibility (see packages/db/src/race-state.ts);
 * this module just holds the live state that compute predicates and
 * API routes read each tick.
 *
 * Parallels AlarmsRegistry: globalThis singleton, no I/O.
 */

export type TimerState = 'idle' | 'pre-start' | 'started' | 'finished';

export interface LineEnd {
  lat: number;
  lon: number;
  /** ISO timestamp the ping was recorded. */
  pingedAt: string;
}

export interface RaceLine {
  port?: LineEnd;
  stbd?: LineEnd;
  /** Which side of the line was the boat on at second-ping time; defines
   *  the sign of DTL going forward. Set by /api/race/line POST handler. */
  preStartSide?: 'port' | 'stbd';
}

export interface RaceTimer {
  /** Epoch ms of the gun. Null while idle. */
  startMs: number | null;
  state: TimerState;
}

export interface RaceSettings {
  /** Degrees of TWD shift vs 5-min baseline that flags a shift event. */
  shiftThresholdDeg: number;
  /** Seconds to project boat vector forward for OCS prediction. */
  ocsLookAheadSec: number;
  /** Layline projection length in NM. Capped at 15 in the UI. */
  laylineDistanceNm: number;
  /** When true, integrate the current grid along the projected layline. */
  integrateCurrent: boolean;
}

export interface RaceStateConfig {
  timer: RaceTimer;
  line: RaceLine;
  activeMarkWaypointId?: string;
  settings: RaceSettings;
}

export function defaultRaceStateConfig(): RaceStateConfig {
  return {
    timer: { startMs: null, state: 'idle' },
    line: {},
    settings: {
      shiftThresholdDeg: 7,
      ocsLookAheadSec: 10,
      laylineDistanceNm: 5,
      integrateCurrent: true,
    },
  };
}

export interface RaceState {
  get(): RaceStateConfig;
  /** Mutate the config via an updater that receives a mutable draft. */
  mutate(updater: (draft: RaceStateConfig) => void): void;
  /** Replace the config wholesale (used at boot from persistence). */
  hydrate(next: RaceStateConfig): void;
  /** Notified on every mutate/hydrate. Returns an unsubscribe. */
  subscribe(handler: (next: RaceStateConfig) => void): () => void;
}

export function createRaceState(initial?: RaceStateConfig): RaceState {
  let current: RaceStateConfig = initial ?? defaultRaceStateConfig();
  const handlers = new Set<(c: RaceStateConfig) => void>();
  function notify(): void {
    for (const h of handlers) h(current);
  }
  return {
    get: () => current,
    mutate(updater) {
      // Shallow-clone the top-level shape so subscribers see a new object
      // identity per mutation (helps React useSyncExternalStore).
      const draft: RaceStateConfig = {
        timer: { ...current.timer },
        line: {
          port: current.line.port ? { ...current.line.port } : undefined,
          stbd: current.line.stbd ? { ...current.line.stbd } : undefined,
          preStartSide: current.line.preStartSide,
        },
        activeMarkWaypointId: current.activeMarkWaypointId,
        settings: { ...current.settings },
      };
      updater(draft);
      current = draft;
      notify();
    },
    hydrate(next) {
      current = next;
      notify();
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

const GLOBAL_KEY = '__g5000_raceState__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_raceState__: RaceState | undefined;
}

export function setSharedRaceState(rs: RaceState): void {
  globalThis[GLOBAL_KEY] = rs;
}

export function getSharedRaceState(): RaceState | null {
  return globalThis[GLOBAL_KEY] ?? null;
}

export function _resetSharedRaceStateForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
