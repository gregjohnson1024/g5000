import { Bus, Channels } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import { tideSnapshot, nearestStation, createTideSources, selectSource, type TideSource, type Station, type TidalEvent } from '@g5000/tide';

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
 * Multi-source tide bus publisher. Builds ADMIRALTY (key-gated) + CHS (no-key)
 * sources; each tick selects the active source by region/override, fetches its
 * station list (per-source weekly cache) and the active station's events
 * (rolling cache keeps a past event), and publishes tide.* + tide.source.
 * When no source is active (no GPS / outside coverage / unavailable) it
 * publishes nothing.
 */
export async function startTideSubsystem(deps: TideSubsystemDeps): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const sources = createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY });

  let activeSource: TideSource | null = null;
  let stations: Station[] = [];
  let active: Station | null = null;
  let activeEvents: TidalEvent[] = [];
  let lastFetchDay = -1;
  let lastPos: { lat: number; lon: number } | null = null;
  const unsubs: Array<() => void> = [];

  async function ensureStations(source: TideSource): Promise<void> {
    const cache = store.getTideConfig().stationsCacheBySource[source.id];
    if (cache && Date.now() - cache.fetchedAtMs < WEEK_MS && cache.stations.length > 0) {
      stations = cache.stations;
      return;
    }
    try {
      stations = await source.listStations();
      const cfg = store.getTideConfig();
      await store.setTideConfig({
        ...cfg,
        stationsCacheBySource: { ...cfg.stationsCacheBySource, [source.id]: { fetchedAtMs: Date.now(), stations } },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[tide] station list fetch failed; using cache', e);
    }
  }

  function resolveStation(source: TideSource): Station | null {
    const pin = store.getTideConfig().pinnedStation;
    if (pin && pin.sourceId === source.id) return stations.find((s) => s.id === pin.stationId) ?? active;
    if (lastPos) return nearestStation(stations, lastPos, active);
    return active;
  }

  async function refresh(): Promise<void> {
    const cfg = store.getTideConfig();
    const nextSource = selectSource(sources, cfg, lastPos);
    if (!nextSource) {
      activeSource = null;
      active = null;
      activeEvents = [];
      return;
    }
    if (nextSource.id !== activeSource?.id) {
      activeSource = nextSource;
      active = null;
      activeEvents = [];
      stations = [];
      lastFetchDay = -1;
      await ensureStations(nextSource);
    }
    const nextStation = resolveStation(nextSource);
    const today = Math.floor(Date.now() / DAY_MS);
    const stationChanged = nextStation?.id !== active?.id;
    if (nextStation && (stationChanged || today !== lastFetchDay)) {
      try {
        const fresh = await nextSource.getTidalEvents(nextStation.id, 7);
        const now = Date.now();
        const pastKept = activeEvents.filter((e) => e.timeMs <= now).slice(-1);
        const merged = stationChanged ? fresh : [...pastKept, ...fresh].sort((a, b) => a.timeMs - b.timeMs);
        activeEvents = merged.filter((e, i, arr) => i === 0 || e.timeMs !== arr[i - 1]!.timeMs);
        active = nextStation;
        lastFetchDay = today;
      } catch (e) {
        // Do NOT advance `active` on failure: keep name+events consistent and
        // retry next tick (stationChanged stays true). If this was the first
        // fetch after a source change, `active` stays null → publishes suppressed.
        // eslint-disable-next-line no-console
        console.warn('[tide] events fetch failed; keeping cached', e);
      }
    } else if (nextStation) {
      active = nextStation;
    }
  }

  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') lastPos = { lat: s.value.value.lat, lon: s.value.value.lon };
    }),
  );

  const tick = async (): Promise<void> => {
    await refresh();
    if (activeSource && active && activeEvents.length > 0) {
      const now = Date.now();
      bus.publish({
        channel: Channels.Tide.Source,
        t_ns: BigInt(Math.round(now * 1e6)),
        value: { kind: 'enum', value: activeSource.id },
        source: 'tide',
      });
      publishTideSnapshot(bus, active.name, activeEvents, now);
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  // eslint-disable-next-line no-console
  console.log('[tide] tide service online (multi-source)');
  return async () => {
    clearInterval(timer);
    for (const u of unsubs) u();
  };
}
