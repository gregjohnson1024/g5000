import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore } from '@g5000/db';
import {
  setSharedConfigStore,
  __resetSharedConfigStoreForTests,
} from '@g5000/db';
import { DEFAULT_POLARS, type PolarTable } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  const path = `${tmpdir()}/polar-rev-api-${Date.now()}-${Math.random()}.db`;
  store = await ConfigStore.open(path);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  __resetSharedConfigStoreForTests();
});

describe('GET /api/polar/revisions', () => {
  it('lists revisions for the active boat (newest first)', async () => {
    const res = await GET(new Request('http://x/api/polar/revisions'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisions: Array<{ id: string }> };
    expect(body.revisions.length).toBeGreaterThanOrEqual(1); // migration's revision-0
  });

  it('filters by sailConfigId', async () => {
    const res = await GET(
      new Request('http://x/api/polar/revisions?sailConfigId=default&mode=default'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisions: Array<{ sailConfigId: string }> };
    for (const r of body.revisions) expect(r.sailConfigId).toBe('default');
  });
});

describe('POST /api/polar/revisions', () => {
  it('creates a revision with valid input', async () => {
    const tweaked: PolarTable = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 1.1)),
    };
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sailConfigId: 'default',
          mode: 'default',
          lineage: { kind: 'manual_edit', source: 'unit-test' },
          table: tweaked,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-z]{26}$/);
  });

  it('returns 400 on an invalid grid', async () => {
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sailConfigId: 'default',
          mode: 'default',
          lineage: { kind: 'manual_edit' },
          table: { twsBins: [5, 3], twaBins: [0, 1], boatSpeed: [[0, 0], [0, 0]] },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on a missing field', async () => {
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'default', table: DEFAULT_POLARS }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
