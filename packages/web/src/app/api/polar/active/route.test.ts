import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-active-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/polar/active', () => {
  it('GET returns the active polar table', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.polar).toHaveProperty('twsBins');
    expect(json.polar).toHaveProperty('twaBins');
    expect(json.polar).toHaveProperty('boatSpeed');
  });

  it('POST returns 501 — no v3 equivalent of v2 active-revision pointer', async () => {
    const res = await POST();
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.error.kind).toBe('not_implemented');
  });
});
