export * from './schema.js';
export * from './defaults.js';
export * from './config-store.js';

import { ConfigStore } from './config-store.js';

let instance: ConfigStore | null = null;

/**
 * Returns the process-wide shared ConfigStore. Throws if not yet set.
 * Set by autopilot-server during boot via `setSharedConfigStore`.
 */
export function getSharedConfigStore(): ConfigStore {
  if (!instance) {
    throw new Error(
      'ConfigStore not initialized — autopilot-server must call setSharedConfigStore() during boot',
    );
  }
  return instance;
}

export function setSharedConfigStore(store: ConfigStore): void {
  instance = store;
}

export function _resetSharedConfigStoreForTests(): void {
  instance = null;
}
