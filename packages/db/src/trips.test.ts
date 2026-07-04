import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  insertTrip,
  listTrips,
  getTrip,
  updateTrip,
  deleteTrip,
  type InsertTripArgs,
} from './trips.js';

function tripArgs(overrides: Partial<InsertTripArgs> = {}): InsertTripArgs {
  return {
    boatId: 'sula',
    startMs: 1_700_000_000_000,
    endMs: 1_700_003_600_000,
    startLat: 41.5,
    startLon: -71.3,
    endLat: 41.6,
    endLon: -71.2,
    distanceM: 12_000,
    durationS: 3600,
    maxSogKn: 8.2,
    avgSogKn: 6.5,
    mode: 'sail',
    pointOfSail: { upwind: 1800, reaching: 1200 },
    stayKind: 'anchor',
    moorageStartName: 'Bristol Marine',
    moorageEndName: null,
    createdMs: 1_700_003_700_000,
    ...overrides,
  };
}

describe('Trips', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-trips-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    expect(await listTrips(store, { boatId: 'sula', limit: 10 })).toEqual([]);
  });

  it('inserts and reads a trip back with JSON round-trip', async () => {
    const id = await insertTrip(store, tripArgs());
    const trip = await getTrip(store, id, 'sula');
    expect(trip).not.toBeNull();
    expect(trip!.startMs).toBe(1_700_000_000_000);
    expect(trip!.distanceM).toBe(12_000);
    expect(trip!.mode).toBe('sail');
    expect(trip!.stayKind).toBe('anchor');
    expect(trip!.pointOfSail).toEqual({ upwind: 1800, reaching: 1200 });
    expect(trip!.moorageStartName).toBe('Bristol Marine');
    expect(trip!.moorageEndName).toBeNull();
    expect(trip!.notes).toBeNull();
  });

  it('lists newest-first and scopes by boatId', async () => {
    await insertTrip(store, tripArgs({ startMs: 1000, endMs: 2000 }));
    await insertTrip(store, tripArgs({ startMs: 5000, endMs: 6000 }));
    await insertTrip(store, tripArgs({ startMs: 3000, endMs: 4000, boatId: 'other' }));
    const rows = await listTrips(store, { boatId: 'sula', limit: 10 });
    expect(rows.map((t) => t.startMs)).toEqual([5000, 1000]);
  });

  it('paginates with beforeMs and filters with fromMs/toMs', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await insertTrip(store, tripArgs({ startMs: i * 1000, endMs: i * 1000 + 500 }));
    }
    const page1 = await listTrips(store, { boatId: 'sula', limit: 2 });
    expect(page1.map((t) => t.startMs)).toEqual([5000, 4000]);
    const page2 = await listTrips(store, { boatId: 'sula', limit: 2, beforeMs: 4000 });
    expect(page2.map((t) => t.startMs)).toEqual([3000, 2000]);
    const ranged = await listTrips(store, { boatId: 'sula', limit: 10, fromMs: 2000, toMs: 4000 });
    expect(ranged.map((t) => t.startMs)).toEqual([4000, 3000, 2000]);
  });

  it('updates only user-editable fields', async () => {
    const id = await insertTrip(store, tripArgs());
    const ok = await updateTrip(store, id, 'sula', {
      mode: 'mixed',
      moorageEndName: 'Potter Cove',
      notes: 'lumpy on the nose',
    });
    expect(ok).toBe(true);
    const trip = await getTrip(store, id, 'sula');
    expect(trip!.mode).toBe('mixed');
    expect(trip!.moorageEndName).toBe('Potter Cove');
    expect(trip!.notes).toBe('lumpy on the nose');
    // Untouched fields survive.
    expect(trip!.distanceM).toBe(12_000);
    // Empty patch is a no-op that still reports existence.
    expect(await updateTrip(store, id, 'sula', {})).toBe(true);
    expect(await updateTrip(store, 9999, 'sula', {})).toBe(false);
  });

  it('update and delete are scoped to boatId', async () => {
    const id = await insertTrip(store, tripArgs());
    expect(await updateTrip(store, id, 'other', { notes: 'nope' })).toBe(false);
    expect(await deleteTrip(store, id, 'other')).toBe(false);
    expect(await getTrip(store, id, 'other')).toBeNull();
    expect(await deleteTrip(store, id, 'sula')).toBe(true);
    expect(await getTrip(store, id, 'sula')).toBeNull();
  });

  it('null pointOfSail stays null', async () => {
    const id = await insertTrip(store, tripArgs({ pointOfSail: null }));
    const trip = await getTrip(store, id, 'sula');
    expect(trip!.pointOfSail).toBeNull();
  });
});
