import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigStore } from './config-store.js';
import { loadRaceState, saveRaceState, DEFAULT_RACE_STATE } from './race-state.js';
import { defaultRaceStateConfig } from '@g5000/core';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(':memory:');
});

describe('race-state persistence', () => {
  it('loadRaceState returns DEFAULT_RACE_STATE when row is missing', async () => {
    const out = await loadRaceState(store);
    expect(out).toEqual(DEFAULT_RACE_STATE);
  });

  it('saveRaceState writes JSON and loadRaceState reads it back', async () => {
    const cfg = defaultRaceStateConfig();
    cfg.timer.startMs = 12345;
    cfg.timer.state = 'pre-start';
    cfg.line.port = { lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T12:00:00Z' };
    cfg.activeMarkWaypointId = 'wp-42';
    await saveRaceState(store, cfg);
    const out = await loadRaceState(store);
    expect(out.timer.startMs).toBe(12345);
    expect(out.timer.state).toBe('pre-start');
    expect(out.line.port).toEqual({ lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T12:00:00Z' });
    expect(out.activeMarkWaypointId).toBe('wp-42');
  });

  it('loadRaceState merges defaults for missing settings keys', async () => {
    // Simulate an older persisted row that has no `integrateCurrent`.
    const drizzle = store.drizzle;
    const { raceState } = await import('./schema.js');
    await drizzle
      .insert(raceState)
      .values({
        id: 'singleton',
        value: JSON.stringify({
          timer: { startMs: null, state: 'idle' },
          line: {},
          settings: { shiftThresholdDeg: 9, ocsLookAheadSec: 5, laylineDistanceNm: 8 },
        }),
      })
      .run();
    const out = await loadRaceState(store);
    expect(out.settings.shiftThresholdDeg).toBe(9);
    expect(out.settings.ocsLookAheadSec).toBe(5);
    expect(out.settings.laylineDistanceNm).toBe(8);
    // Missing key falls back to default.
    expect(out.settings.integrateCurrent).toBe(true);
  });

  it('loadRaceState returns DEFAULT_RACE_STATE when row JSON is malformed', async () => {
    const drizzle = store.drizzle;
    const { raceState } = await import('./schema.js');
    await drizzle.insert(raceState).values({ id: 'singleton', value: 'not json' }).run();
    const out = await loadRaceState(store);
    expect(out).toEqual(DEFAULT_RACE_STATE);
  });
});
