import { Bus, Channels } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import { tideSnapshot, nearestStation, listStations, getTidalEvents, type Station, type TidalEvent } from '@g5000/tide';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TICK_MS = 30_000;

/** Pure: map a tide snapshot at nowMs to published channels. Exported for tests. */
export function publishTideSnapshot(
  bus: Bus,
  stationName: string,
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
): void {
  const t_ns = BigInt(Math.round(nowMs * 1e6));
  const enumPub = (channel: string, value: string): void =>
    bus.publish({ channel, t_ns, value: { kind: 'enum', value }, source: 'tide' });
  const scalarPub = (channel: string, value: number, unit: string): void =>
    bus.publish({ channel, t_ns, value: { kind: 'scalar', value, unit }, source: 'tide' });

  enumPub(Channels.Tide.Station, stationName);
  const snap = tideSnapshot(events, nowMs);
  if (snap.heightNowM !== null) scalarPub(Channels.Tide.HeightNow, snap.heightNowM, 'm');
  if (snap.state !== null) enumPub(Channels.Tide.State, snap.state);
  if (snap.next) {
    enumPub(Channels.Tide.NextEventType, snap.next.type);
    scalarPub(Channels.Tide.NextEventInSec, Math.max(0, (snap.next.timeMs - nowMs) / 1000), 's');
    scalarPub(Channels.Tide.NextEventHeight, snap.next.heightM, 'm');
  }
}

export interface TideSubsystemDeps {
  bus: Bus;
  store: ConfigStore;
}

/**
 * Tide bus publisher. Graceful-off when ADMIRALTY_TIDAL_API_KEY is unset.
 * - Loads the station list (ConfigStore cache, refreshed weekly).
 * - Active station = pinned, else nearest to nav.gps.position (hysteresis).
 * - Daily fetch of the active station's events (rolling cache keeps a past event).
 * - ~30 s interpolation tick publishes tide.* from the cached events.
 */
export async function startTideSubsystem(deps: TideSubsystemDeps): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const key = process.env.ADMIRALTY_TIDAL_API_KEY;
  if (!key) {
    // eslint-disable-next-line no-console
    console.log('[tide] ADMIRALTY_TIDAL_API_KEY unset — tide service disabled');
    return async () => {};
  }

  let stations: Station[] = store.getTideConfig().stationsCache?.stations ?? [];
  let active: Station | null = null;
  let activeEvents: TidalEvent[] = [];
  let lastFetchDay = -1;
  let lastPos: { lat: number; lon: number } | null = null;
  const unsubs: Array<() => void> = [];

  async function ensureStations(): Promise<void> {
    const cache = store.getTideConfig().stationsCache;
    if (cache && Date.now() - cache.fetchedAtMs < WEEK_MS && cache.stations.length > 0) {
      stations = cache.stations;
      return;
    }
    try {
      stations = await listStations(key!);
      await store.setTideConfig({ ...store.getTideConfig(), stationsCache: { fetchedAtMs: Date.now(), stations } });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[tide] station list fetch failed; using cache', e);
    }
  }

  function resolveActive(): Station | null {
    const cfg = store.getTideConfig();
    if (cfg.pinnedStationId) {
      return stations.find((s) => s.id === cfg.pinnedStationId) ?? active;
    }
    if (lastPos) return nearestStation(stations, lastPos, active);
    if (cfg.defaultStationId) return stations.find((s) => s.id === cfg.defaultStationId) ?? null;
    return active;
  }

  async function refreshEventsIfNeeded(): Promise<void> {
    const next = resolveActive();
    const today = Math.floor(Date.now() / DAY_MS);
    const changed = next?.id !== active?.id;
    if (next && (changed || today !== lastFetchDay)) {
      try {
        const fresh = await getTidalEvents(key!, next.id, 7);
        const now = Date.now();
        const pastKept = activeEvents.filter((e) => e.timeMs <= now).slice(-1);
        const merged = changed ? fresh : [...pastKept, ...fresh].sort((a, b) => a.timeMs - b.timeMs);
        activeEvents = merged.filter((e, i, arr) => i === 0 || e.timeMs !== arr[i - 1]!.timeMs);
        active = next;
        lastFetchDay = today;
      } catch (e) {
        // Do NOT advance `active` on failure: keep it on the last
        // successfully-fetched station so publishes stay self-consistent
        // (name matches events) and the next tick still sees changed===true
        // and retries the fetch.
        // eslint-disable-next-line no-console
        console.warn('[tide] events fetch failed; keeping cached', e);
      }
    } else if (next) {
      active = next;
    }
  }

  await ensureStations();

  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') lastPos = { lat: s.value.value.lat, lon: s.value.value.lon };
    }),
  );

  const tick = async (): Promise<void> => {
    await refreshEventsIfNeeded();
    if (active && activeEvents.length > 0) {
      publishTideSnapshot(bus, active.name, activeEvents, Date.now());
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  // eslint-disable-next-line no-console
  console.log('[tide] tide service online');
  return async () => {
    clearInterval(timer);
    for (const u of unsubs) u();
  };
}
