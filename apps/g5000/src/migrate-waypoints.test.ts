import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '@g5000/db';
import { migrateWaypointsJson } from './migrate-waypoints.js';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-mig-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrateWaypointsJson', () => {
  it('imports waypoints and renames the file', async () => {
    const file = path.join(dir, 'waypoints.json');
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'foo', name: 'Foo', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );
    await migrateWaypointsJson(store, file);
    expect(store.getWaypoints().find((w) => w.id === 'foo')).toBeDefined();
    expect(existsSync(file)).toBe(false);
    expect(existsSync(file + '.migrated')).toBe(true);
  });

  it('no-ops when the store already has waypoints', async () => {
    await store.setWaypoints([
      { id: 'x', name: 'X', lat: 0, lon: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const file = path.join(dir, 'waypoints.json');
    writeFileSync(
      file,
      JSON.stringify([{ id: 'foo', name: 'Foo', lat: 1, lon: 1, createdAt: 'x' }]),
    );
    await migrateWaypointsJson(store, file);
    expect(store.getWaypoints().map((w) => w.id)).toEqual(['x']);
    expect(existsSync(file)).toBe(true);
  });

  it('no-ops when the file is absent', async () => {
    await migrateWaypointsJson(store, path.join(dir, 'nope.json'));
    expect(store.getWaypoints()).toEqual([]);
  });
});
