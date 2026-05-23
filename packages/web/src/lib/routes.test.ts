import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  routesUsingWaypoint,
} from './routes.js';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-rts-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
  setSharedConfigStore(store);
  await store.setWaypoints([
    { id: 'a', name: 'A', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', name: 'B', lat: 42, lon: -72, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('routes lib', () => {
  it('creates a route referencing existing waypoints', async () => {
    const r = await createRoute({ name: 'R', waypointIds: ['a', 'b'] });
    expect(r.id).toBe('r');
    expect(r.waypointIds).toEqual(['a', 'b']);
    expect((await listRoutes()).length).toBe(1);
  });

  it('rejects unknown waypoint ids', async () => {
    await expect(createRoute({ name: 'Bad', waypointIds: ['a', 'ghost'] })).rejects.toThrow(
      /unknown waypoint/i,
    );
  });

  it('updates and deletes', async () => {
    await createRoute({ name: 'R', waypointIds: ['a'] });
    const upd = await updateRoute('r', { waypointIds: ['a', 'b'] });
    expect(upd?.waypointIds).toEqual(['a', 'b']);
    expect(await deleteRoute('r')).toBe(true);
  });

  it('reports routes using a waypoint', async () => {
    await createRoute({ name: 'R', waypointIds: ['a', 'b'] });
    expect((await routesUsingWaypoint('b')).map((r) => r.name)).toEqual(['R']);
    expect(await routesUsingWaypoint('a')).toHaveLength(1);
  });
});
