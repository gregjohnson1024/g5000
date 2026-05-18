import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
  DEFAULT_CROSSOVER_SETTINGS,
} from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/crossover-settings-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/crossover-settings', () => {
  it('returns defaults on a fresh store', async () => {
    const res = await GET();
    const json = (await res.json()) as { ok: boolean; settings: typeof DEFAULT_CROSSOVER_SETTINGS };
    expect(json.ok).toBe(true);
    expect(json.settings).toEqual(DEFAULT_CROSSOVER_SETTINGS);
  });
});

describe('POST /api/crossover-settings', () => {
  it('persists a posted settings object', async () => {
    const body = { ...DEFAULT_CROSSOVER_SETTINGS, recommendationStableSeconds: 90 };
    const req = new Request('http://localhost/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; settings: typeof DEFAULT_CROSSOVER_SETTINGS };
    expect(json.settings.recommendationStableSeconds).toBe(90);
  });

  it('400s on malformed body', async () => {
    const req = new Request('http://localhost/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect((await POST(req)).status).toBe(400);
  });
});
