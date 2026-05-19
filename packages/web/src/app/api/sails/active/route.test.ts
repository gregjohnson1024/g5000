import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/sails-active-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
  await store.setSails({
    schemaVersion: 3,
    boatId: 'sula',
    sails: [
      { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
      { id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } },
    ],
    active: {},
    activeMode: 'default',
  });
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/sails/active route', () => {
  it('POST sets active sail for a category', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'headsail', sailId: 'j0' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('POST with sailId=null clears the active sail', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'main', sailId: null }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('POST rejects unknown category', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'mizzen', sailId: null }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST rejects sailId not matching the category', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'headsail', sailId: 'reef1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
