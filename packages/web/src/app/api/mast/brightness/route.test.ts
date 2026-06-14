import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-brightness-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/brightness', () => {
  it('GET returns the default brightness', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; brightnessPct: number };
    expect(body.ok).toBe(true);
    expect(body.brightnessPct).toBe(80);
  });

  it('POST round-trips a valid value', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ brightnessPct: 30 }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { brightnessPct: number };
    expect(back.brightnessPct).toBe(30);
  });

  it('POST rejects out-of-range / non-integer', async () => {
    for (const v of [-1, 101, 4.2, 'x']) {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ brightnessPct: v }) }));
      expect(res.status).toBe(400);
    }
  });
});
