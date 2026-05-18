import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { firstValueFrom } from 'rxjs';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
  DEFAULT_POLARS,
} from '@g5000/db';
import { POST } from './route.js';

let store: ConfigStore;
let initialRevId: string;
let secondRevId: string;
const slotId = 'default';

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-active-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
  initialRevId = store.listRevisions()[0]!.id;
  // Create a second revision to switch between.
  const second = {
    id: '01HABCDEFGHJKMNPQRSTVWXYZA',
    boatId: 'sula',
    sailConfigId: slotId,
    mode: 'default' as const,
    parentRevisionId: initialRevId,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'manual_edit' as const },
    table: DEFAULT_POLARS,
  };
  await store.createRevision(second);
  secondRevId = second.id;
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('POST /api/polar/active', () => {
  it('switches the active revision for a slot+mode', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sailConfigId: slotId, mode: 'default', revisionId: secondRevId }),
      }),
    );
    expect(res.status).toBe(200);
    const wardrobe = await firstValueFrom(store.sails$);
    expect(wardrobe.configs[0]!.modes.default!.activeRevisionId).toBe(secondRevId);
  });

  it('returns 404 when revisionId is unknown', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sailConfigId: slotId, mode: 'default', revisionId: 'nope' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on missing fields', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'default', revisionId: secondRevId }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
