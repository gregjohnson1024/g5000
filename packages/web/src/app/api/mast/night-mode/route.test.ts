import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-nightmode-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/night-mode', () => {
  it('GET returns the default (false)', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; nightMode: boolean };
    expect(body.ok).toBe(true);
    expect(body.nightMode).toBe(false);
  });

  it('POST round-trips true', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ nightMode: true }) }));
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { nightMode: boolean };
    expect(back.nightMode).toBe(true);
  });

  it('POST rejects a non-boolean', async () => {
    for (const v of [1, 'true', null]) {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ nightMode: v }) }));
      expect(res.status).toBe(400);
    }
  });
});
