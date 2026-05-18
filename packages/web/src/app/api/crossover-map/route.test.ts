import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/crossover-map-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/crossover-map', () => {
  it('returns the default empty map on a fresh store', async () => {
    const res = await GET();
    const json = (await res.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.ok).toBe(true);
    expect(json.map.cells).toEqual({});
  });
});

describe('POST /api/crossover-map', () => {
  it('persists a posted map and the next GET reflects it', async () => {
    const body = {
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,3': 'default' }, // 'default' is the seeded config id
    };
    const req = new Request('http://localhost/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.map.cells['2,3']).toBe('default');
  });

  it('strips configIds not present in the wardrobe on write', async () => {
    const body = {
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,3': 'default', '4,5': 'nonexistent-config' },
    };
    const res = await POST(
      new Request('http://localhost/api/crossover-map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.map.cells['2,3']).toBe('default');
    expect(json.map.cells['4,5']).toBeUndefined();
  });

  it('400s on malformed body', async () => {
    const req = new Request('http://localhost/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{notjson',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
