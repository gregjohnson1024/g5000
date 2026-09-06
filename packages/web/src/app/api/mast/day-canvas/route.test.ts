import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-daycanvas-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/day-canvas', () => {
  it('GET returns the default (black)', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; dayCanvas: string };
    expect(body.ok).toBe(true);
    expect(body.dayCanvas).toBe('black');
  });

  it('POST round-trips white', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ dayCanvas: 'white' }) }),
    );
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { dayCanvas: string };
    expect(back.dayCanvas).toBe('white');
  });

  it('POST rejects anything outside DAY_CANVASES', async () => {
    for (const v of ['grey', 'cream', 42, null, true]) {
      const res = await POST(
        new Request('http://x', { method: 'POST', body: JSON.stringify({ dayCanvas: v }) }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('POST rejects malformed JSON', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('does not disturb dayBaseColor when the canvas changes', async () => {
    // Both live in the same DisplayConfig blob, so a careless spread would
    // clobber one when writing the other.
    await store.setDisplayConfig({ ...store.getDisplayConfig(), dayBaseColor: 'cyan' });
    await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ dayCanvas: 'white' }) }),
    );
    expect(store.getDisplayConfig().dayBaseColor).toBe('cyan');
    expect(store.getDisplayConfig().dayCanvas).toBe('white');
  });
});
