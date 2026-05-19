import type { Bus } from '@g5000/core';
import { Channels } from '@g5000/core';
import { type ConfigStore, insertShipLogEntry, lastAutoEntryTsMs } from '@g5000/db';

const RAD_TO_DEG = 180 / Math.PI;
const MS_TO_KN = 1 / 0.514444;
const HOUR_MS = 60 * 60_000;
/** How often we check whether an hourly entry is due. */
const TICK_MS = 60_000;
/** Skip writing if the latest position fix is older than this. */
const STALE_MS = 10 * 60_000;

interface NumberCache {
  value: number;
  atMs: number;
}

interface GeoCache {
  lat: number;
  lon: number;
  atMs: number;
}

/**
 * Hourly auto-logger for the ship's log. Subscribes to position/COG/SOG/HDG
 * + true wind, keeps a tiny last-value cache, and writes one `auto`/`position`
 * row per hour. Skips writing if there has never been a position fix in the
 * last 10 minutes — no point logging a stale fix as if it were current.
 *
 * The DB write is the authoritative "have we logged this hour" signal, so a
 * service restart mid-hour doesn't double-log: on boot it reads
 * `lastAutoEntryTsMs` and only fires once `Date.now() - last >= HOUR_MS`.
 */
export interface ShipLogAutoHandle {
  dispose: () => void;
}

export function startShipLogAuto(args: {
  bus: Bus;
  store: ConfigStore;
  boatId: string;
}): ShipLogAutoHandle {
  const { bus, store, boatId } = args;
  let pos: GeoCache | null = null;
  let cog: NumberCache | null = null;
  let sog: NumberCache | null = null;
  let hdg: NumberCache | null = null;
  let tws: NumberCache | null = null;
  let twd: NumberCache | null = null;

  const subs: Array<() => void> = [];
  subs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') {
        pos = { lat: s.value.value.lat, lon: s.value.value.lon, atMs: Date.now() };
      }
    }),
  );
  subs.push(
    bus.subscribe(Channels.Nav.Cog, (s) => {
      if (s.value.kind === 'scalar') cog = { value: s.value.value, atMs: Date.now() };
    }),
  );
  subs.push(
    bus.subscribe(Channels.Nav.Sog, (s) => {
      if (s.value.kind === 'scalar') sog = { value: s.value.value, atMs: Date.now() };
    }),
  );
  subs.push(
    bus.subscribe(Channels.Boat.HeadingMagnetic, (s) => {
      if (s.value.kind === 'scalar') hdg = { value: s.value.value, atMs: Date.now() };
    }),
  );
  subs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') tws = { value: s.value.value, atMs: Date.now() };
    }),
  );
  subs.push(
    bus.subscribe(Channels.Wind.TrueDirection, (s) => {
      if (s.value.kind === 'scalar') twd = { value: s.value.value, atMs: Date.now() };
    }),
  );

  const maybeLog = async (): Promise<void> => {
    if (!pos) return;
    const now = Date.now();
    if (now - pos.atMs > STALE_MS) return;
    const last = await lastAutoEntryTsMs(store, boatId);
    if (last !== null && now - last < HOUR_MS) return;
    await insertShipLogEntry(store, {
      tsMs: now,
      source: 'auto',
      kind: 'position',
      lat: pos.lat,
      lon: pos.lon,
      cogDeg: cog ? (((cog.value * RAD_TO_DEG) % 360) + 360) % 360 : null,
      sogKn: sog ? sog.value * MS_TO_KN : null,
      hdgDeg: hdg ? (((hdg.value * RAD_TO_DEG) % 360) + 360) % 360 : null,
      twsKn: tws ? tws.value * MS_TO_KN : null,
      twdDeg: twd ? (((twd.value * RAD_TO_DEG) % 360) + 360) % 360 : null,
      author: null,
      boatId,
    });
  };

  // Tick once on startup so a restart inside a long-gap window logs as soon
  // as a fresh fix arrives; then on a regular cadence.
  const timer = setInterval(() => {
    void maybeLog();
  }, TICK_MS);
  void maybeLog();

  return {
    dispose: () => {
      clearInterval(timer);
      for (const u of subs) u();
    },
  };
}
