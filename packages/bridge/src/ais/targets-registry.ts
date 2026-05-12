import {
  setSharedAisTargets,
  getSharedAisTargets,
  type AisTarget,
  type AisTargetsRegistry,
} from '@g5000/core';

/**
 * Create (or return the existing) shared AIS targets registry. Idempotent —
 * subsequent calls return the same instance so that `bridge` and any
 * web-route handler living in the same process see the same Map.
 */
export function createAisTargetsRegistry(): AisTargetsRegistry {
  const existing = getSharedAisTargets();
  if (existing) return existing;

  const byMmsi = new Map<number, AisTarget>();
  const registry: AisTargetsRegistry = {
    all: () => Array.from(byMmsi.values()),
    get: (mmsi) => byMmsi.get(mmsi),
    upsert: (u) => {
      const prev = byMmsi.get(u.mmsi);
      // Spread prev first so explicit `undefined` values in the update don't
      // wipe out previously-set fields — but most callers pass partials, not
      // explicit-undefined. Either way `lastSeenMs` is always overwritten.
      const merged: AisTarget = {
        ...(prev ?? {
          mmsi: u.mmsi,
          vesselClass: u.vesselClass ?? 'unknown',
          lastSeenMs: 0,
        }),
        ...u,
        lastSeenMs: Date.now(),
      };
      byMmsi.set(u.mmsi, merged);
    },
    evictStale: (maxAgeMs) => {
      const cutoff = Date.now() - maxAgeMs;
      let dropped = 0;
      for (const [mmsi, t] of byMmsi) {
        if (t.lastSeenMs < cutoff) {
          byMmsi.delete(mmsi);
          dropped += 1;
        }
      }
      return dropped;
    },
    clear: () => byMmsi.clear(),
  };
  setSharedAisTargets(registry);
  return registry;
}
