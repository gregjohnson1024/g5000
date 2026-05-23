import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import {
  listWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  SEED_WAYPOINT_IDS,
} from './waypoints';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-wps-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('waypoints lib (ConfigStore)', () => {
  it('seeds the canonical waypoints into an empty store', async () => {
    const list = await listWaypoints();
    for (const id of SEED_WAYPOINT_IDS) {
      expect(list.find((w) => w.id === id)).toBeDefined();
    }
  });

  it('creates, updates, deletes', async () => {
    const wp = await createWaypoint({ name: 'Test', lat: 41.5, lon: -71.3 });
    expect(wp.id).toBe('test');
    const upd = await updateWaypoint('test', { name: 'Test 2' });
    expect(upd?.name).toBe('Test 2');
    expect(await deleteWaypoint('test')).toBe(true);
    const list = await listWaypoints();
    expect(list.find((w) => w.id === 'test')).toBeUndefined();
  });
});
