import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
  DEFAULT_POLARS,
  type PolarRevision,
} from '@g5000/db';
import { GET } from './route.js';

let store: ConfigStore;
let seedId: string;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-rev-id-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
  const seed: PolarRevision = {
    id: ulid(),
    boatId: 'sula',
    sailConfigId: 'default',
    mode: 'default',
    parentRevisionId: null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'migrated' },
    table: DEFAULT_POLARS,
  };
  await store.createRevision(seed);
  seedId = seed.id;
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/polar/revisions/[id]', () => {
  it('returns the revision when found', async () => {
    const res = await GET(new Request(`http://x/api/polar/revisions/${seedId}`), {
      params: Promise.resolve({ id: seedId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: { id: string } };
    expect(body.revision.id).toBe(seedId);
  });

  it('returns 404 when unknown', async () => {
    const res = await GET(new Request('http://x/api/polar/revisions/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
