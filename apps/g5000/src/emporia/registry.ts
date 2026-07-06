import {
  getSharedEmporia,
  setSharedEmporia,
  EMPORIA_OFFLINE_SNAPSHOT,
  type EmporiaRegistry,
  type EmporiaSnapshot,
  type EmporiaDevice,
} from '@g5000/core';

/**
 * Create (or return the existing) shared Emporia registry. Idempotent —
 * subsequent calls return the same instance so that the Emporia driver and
 * any web-route handler living in the same process see the same snapshot.
 */
export function createEmporiaRegistry(): EmporiaRegistry {
  const existing = getSharedEmporia();
  if (existing) return existing;

  let _snapshot: EmporiaSnapshot = EMPORIA_OFFLINE_SNAPSHOT;
  let _devices: EmporiaDevice[] = [];

  const registry: EmporiaRegistry = {
    setSnapshot(s: EmporiaSnapshot): void {
      _snapshot = s;
    },
    snapshot(): EmporiaSnapshot {
      return _snapshot;
    },
    setDevices(d: EmporiaDevice[]): void {
      _devices = d;
    },
    devices(): EmporiaDevice[] {
      return _devices;
    },
    markStale(): void {
      _snapshot = { ..._snapshot, connected: false };
    },
  };

  setSharedEmporia(registry);
  return registry;
}
