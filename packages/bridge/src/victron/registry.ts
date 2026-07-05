import { getSharedVictron, setSharedVictron, type VictronRegistry } from '@g5000/core';
import { applyMessage, deriveSnapshot, type RawVictronState } from './topics.js';

/**
 * Create (or return the existing) shared Victron registry. Idempotent —
 * subsequent calls return the same instance so that `bridge` and any
 * web-route handler living in the same process see the same snapshot.
 */
export function createVictronRegistry(): VictronRegistry {
  const existing = getSharedVictron();
  if (existing) return existing;

  const state: RawVictronState = { byKey: new Map() };
  let connected = false;
  let lastMs = 0;

  const registry: VictronRegistry = {
    update: (topic, payloadJson) => {
      applyMessage(state, topic, payloadJson);
      lastMs = Date.now();
    },
    snapshot: () => deriveSnapshot(state, lastMs, connected),
    markStale: () => {
      connected = false;
    },
    connected: () => connected,
    setConnected: (v) => {
      connected = v;
    },
    clear: () => {
      state.byKey.clear();
      connected = false;
      lastMs = 0;
    },
  };
  setSharedVictron(registry);
  return registry;
}
