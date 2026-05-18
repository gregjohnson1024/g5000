import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-rev-id-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/polar/revisions/[id]', () => {
  it('returns the revision when found', async () => {
    const seed = store.listRevisions()[0]!;
    const res = await GET(new Request(`http://x/api/polar/revisions/${seed.id}`), {
      params: Promise.resolve({ id: seed.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: { id: string } };
    expect(body.revision.id).toBe(seed.id);
  });

  it('returns 404 when unknown', async () => {
    const res = await GET(new Request('http://x/api/polar/revisions/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
