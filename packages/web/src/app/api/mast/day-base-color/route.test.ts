import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-daycolor-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/day-base-color', () => {
  it('GET returns the default (white)', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; dayBaseColor: string };
    expect(body.ok).toBe(true);
    expect(body.dayBaseColor).toBe('white');
  });

  it('POST round-trips a valid colour', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ dayBaseColor: 'cyan' }) }));
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { dayBaseColor: string };
    expect(back.dayBaseColor).toBe('cyan');
  });

  it('POST rejects an invalid colour', async () => {
    for (const v of ['mauve', 42, null]) {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ dayBaseColor: v }) }));
      expect(res.status).toBe(400);
    }
  });
});
