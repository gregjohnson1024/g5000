import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(
    `${tmpdir()}/crossover-settings-${Date.now()}-${Math.random()}.db`,
  );
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/crossover-settings', () => {
  it('GET returns the 3-field shape', async () => {
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'forecastDurationHours',
      'forecastIntervalMinutes',
      'recommendationStableSeconds',
    ]);
  });

  it('POST round-trips', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        recommendationStableSeconds: 10,
        forecastIntervalMinutes: 15,
        forecastDurationHours: 6,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { recommendationStableSeconds: number };
    expect(back.recommendationStableSeconds).toBe(10);
  });
});
