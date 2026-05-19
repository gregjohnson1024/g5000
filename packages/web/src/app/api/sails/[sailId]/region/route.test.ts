import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/sails-region-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
  await store.setSails({
    schemaVersion: 3,
    boatId: 'sula',
    sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
    active: {},
    activeMode: 'default',
  });
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/sails/[sailId]/region route', () => {
  it('POST replaces cells for the given sail', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['10,5', '12,9'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(200);
  });

  it('POST returns 404 for unknown sail', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['1,1'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('POST rejects out-of-bounds cell keys', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['99,99'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(400);
  });

  it('POST rejects malformed cell keys', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['hello'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(400);
  });
});
