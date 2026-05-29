import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Bus } from '@g5000/core';
import { createRaceState, setSharedRaceState, getSharedCogStats } from '@g5000/core';
import { type ConfigStore, loadRaceState, saveRaceState, type PolarTable } from '@g5000/db';
import { startRaceComputePipeline, type LatLon } from '@g5000/compute/race';
import type { CurrentField } from '@g5000/grib';

const SOCKETCAN_ROOT = process.env.G5000_ROUTER_ROOT ?? path.join(homedir(), '.g5000-router');

/**
 * Race state + pipeline. Runs regardless of source mode (live, demo, or
 * replay) so that replay-driven integration tests can exercise race compute.
 *
 * Returns a teardown that unwinds in the same order the boot-time
 * `teardown.push` calls used to unwind under the reversed shutdown array:
 * dispose the race pipeline, then clear the COG poll, then clear the
 * waypoints refresh. The polar subscription and the debounced-save
 * subscription are intentionally left un-torn-down (they leak for process
 * lifetime — unchanged from before).
 */
export async function startRaceSubsystem(deps: {
  bus: Bus;
  store: ConfigStore;
}): Promise<() => Promise<void>> {
  const { bus, store } = deps;

  const raceStateConfig = await loadRaceState(store);
  // Boot-time staleness reset: clear timer if startMs is >1h in the past.
  if (
    raceStateConfig.timer.startMs !== null &&
    Date.now() - raceStateConfig.timer.startMs > 3_600_000
  ) {
    raceStateConfig.timer.startMs = null;
    raceStateConfig.timer.state = 'idle';
    await saveRaceState(store, raceStateConfig);
  }
  const raceState = createRaceState(raceStateConfig);
  setSharedRaceState(raceState);

  // Polar ref: peek the most-recently-published polar.
  const polarRef: { current: PolarTable | null } = { current: null };
  store.activePolar$.subscribe((p) => {
    polarRef.current = p;
  });

  // Current field ref: v1 leaves this null — the pipeline degrades to
  // "no current integration" for laylines. A follow-up issue can subscribe
  // to the in-process current-field cache once one is exposed.
  const currentFieldRef: { current: CurrentField | null } = { current: null };

  // Waypoints ref: populated from ~/.g5000-router/waypoints.json at boot and
  // refreshed every 5 s so mutations made via the web UI are picked up without
  // a server restart. Reading directly avoids importing @g5000/web from here.
  const waypointsPath = path.join(SOCKETCAN_ROOT, 'waypoints.json');

  interface RawWaypoint {
    id: string;
    lat: number;
    lon: number;
  }

  function isRawWaypoint(v: unknown): v is RawWaypoint {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o.id === 'string' && typeof o.lat === 'number' && typeof o.lon === 'number';
  }

  async function refreshWaypoints(): Promise<void> {
    try {
      const buf = await readFile(waypointsPath, 'utf8');
      const parsed = JSON.parse(buf) as unknown;
      if (!Array.isArray(parsed)) return;
      const next = new Map<string, LatLon>();
      for (const w of parsed) {
        if (isRawWaypoint(w)) next.set(w.id, { lat: w.lat, lon: w.lon });
      }
      waypointsRef.current = next;
    } catch {
      /* keep previous map — ENOENT on fresh install, parse errors, etc. */
    }
  }

  const waypointsRef: { current: Map<string, LatLon> } = { current: new Map() };
  await refreshWaypoints();
  const waypointsRefreshInterval = setInterval(() => {
    void refreshWaypoints();
  }, 5000);

  // COG concentration ref: initialised to 0 (conservative — OCS predictor
  // will return null until the COG stats window has enough data). Updated at
  // 200 ms from the shared COG stats singleton that startCogStats registers.
  // Using a lightweight poll here (inside g5000 app where I/O is
  // allowed) avoids HTTP self-calls and keeps @g5000/compute boundary-clean.
  const cogConcentrationRef: { current: number } = { current: 0 };
  const cogConcentrationPoll = setInterval(() => {
    const stats = getSharedCogStats();
    if (stats) cogConcentrationRef.current = stats.snapshot().concentration;
  }, 200);

  const raceHandle = startRaceComputePipeline(
    bus,
    raceState,
    polarRef,
    currentFieldRef,
    waypointsRef,
    cogConcentrationRef,
  );

  // Persist on every mutation (debounced 500 ms).
  let raceSaveTimer: ReturnType<typeof setTimeout> | null = null;
  raceState.subscribe(() => {
    if (raceSaveTimer) clearTimeout(raceSaveTimer);
    raceSaveTimer = setTimeout(() => {
      void saveRaceState(store, raceState.get()).catch(() => undefined);
    }, 500);
  });
  // eslint-disable-next-line no-console
  console.log('[autopilot] race compute pipeline online');

  return async () => {
    raceHandle.dispose();
    clearInterval(cogConcentrationPoll);
    clearInterval(waypointsRefreshInterval);
  };
}
