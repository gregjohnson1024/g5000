import { getSharedBus, type Sample } from '@g5000/core';
import { getSharedConfigStore } from '@g5000/db';
import { UTC_CLOCK, resolveClock, type ClockConfig, type ShipClock } from './tz';

/**
 * Server-side ship-clock resolution — the API-route counterpart of the
 * client's useShipClock(). Reads the boat-wide ClockConfig from ConfigStore
 * and, when the offset is on auto, the last GPS longitude from a process-
 * wide bus subscriber (the Bus has no replay, so a per-request subscribe
 * could not see a fix synchronously).
 *
 * Degradation mirrors the client: no ConfigStore (vitest) → UTC; ship+auto
 * with no fix yet (including the first call after boot, before a 1 Hz
 * position sample lands) → offset 0, never a guess. Source-priority rules
 * are deliberately not applied here: nautical zones are 15° wide, so any
 * GPS source that can see the sky picks the same zone.
 */

interface LastFixCache {
  lon: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __g5kServerLastFix__: LastFixCache | undefined;
}

/** Idempotent: first call subscribes for the life of the process. */
function lastFix(): LastFixCache | null {
  if (globalThis.__g5kServerLastFix__) return globalThis.__g5kServerLastFix__;
  try {
    const bus = getSharedBus();
    const cache: LastFixCache = { lon: null };
    bus.subscribe('nav.gps.position', (s: Sample) => {
      if (s.value.kind === 'geo') cache.lon = s.value.value.lon;
    });
    globalThis.__g5kServerLastFix__ = cache;
    return cache;
  } catch {
    return null; // bus not initialised (tests)
  }
}

/** The resolved boat-wide clock for server-rendered text. */
export function getServerClock(): ShipClock {
  let cfg: ClockConfig;
  try {
    cfg = getSharedConfigStore().getDisplayConfig().clock ?? { mode: 'utc', offsetMin: null };
  } catch {
    return UTC_CLOCK; // ConfigStore not initialised (tests)
  }
  const auto = cfg.mode === 'ship' && cfg.offsetMin === null;
  const lon = auto ? (lastFix()?.lon ?? null) : null;
  return resolveClock(cfg, lon);
}
