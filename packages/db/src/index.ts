export * from './schema.js';
export * from './defaults.js';
export * from './config-store.js';
export { validatePolarTable } from './polar-revisions.js';
export * from './alarms-config.js';
export * from './alarms-history.js';
export * from './ship-log.js';
export * from './race-state.js';
export type { Waypoint, Route } from './waypoints-routes-types.js';
export type { BoatState } from './boat-state.js';
export { DEFAULT_BOAT_STATE } from './boat-state.js';

import { ConfigStore } from './config-store.js';

// Store the singleton on globalThis so that module re-evaluations within the
// same process (e.g. Next.js / Turbopack loading the package a second time)
// still resolve the instance set by g5000 app during boot.
const GLOBAL_KEY = '__g5000_configStore__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_configStore__: ConfigStore | undefined;
}

/**
 * Returns the process-wide shared ConfigStore. Throws if not yet set.
 * Set by g5000 app during boot via `setSharedConfigStore`.
 */
export function getSharedConfigStore(): ConfigStore {
  const store = globalThis[GLOBAL_KEY];
  if (!store) {
    throw new Error(
      'ConfigStore not initialized — g5000 app must call setSharedConfigStore() during boot',
    );
  }
  return store;
}

export function setSharedConfigStore(store: ConfigStore): void {
  globalThis[GLOBAL_KEY] = store;
}

/** Test-only: clears the singleton. Do not call from production code. */
export function _resetSharedConfigStoreForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
