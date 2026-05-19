import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET, PUT } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/sails-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/sails route', () => {
  it('GET returns v3 wardrobe', async () => {
    const res = await GET();
    const body = (await res.json()) as { schemaVersion: number; sails: unknown[] };
    expect(body.schemaVersion).toBe(3);
    expect(Array.isArray(body.sails)).toBe(true);
  });

  it('PUT accepts a valid v3 wardrobe and round-trips', async () => {
    const wardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
      active: { headsail: 'j0' },
      activeMode: 'default',
    };
    const req = new Request('http://x/api/sails', {
      method: 'PUT',
      body: JSON.stringify(wardrobe),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as {
      sails: unknown[];
      active: { headsail?: string };
    };
    expect(back.sails).toHaveLength(1);
    expect(back.active.headsail).toBe('j0');
  });

  it('PUT rejects wardrobe with duplicate sail ids', async () => {
    const wardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
        { id: 'j0', name: 'J0 alt', category: 'headsail', region: { cells: [] } },
      ],
      active: {},
      activeMode: 'default',
    };
    const req = new Request('http://x/api/sails', {
      method: 'PUT',
      body: JSON.stringify(wardrobe),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
