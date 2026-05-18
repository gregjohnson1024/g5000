import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ConfigStore } from './config-store.js';
import { DEFAULT_CROSSOVER_SETTINGS } from './defaults.js';

const stores: ConfigStore[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

async function freshStore() {
  const s = await ConfigStore.open(':memory:');
  stores.push(s);
  return s;
}

describe('ConfigStore — crossover settings', () => {
  it('returns DEFAULT_CROSSOVER_SETTINGS on a fresh store', async () => {
    const store = await freshStore();
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s).toEqual(DEFAULT_CROSSOVER_SETTINGS);
  });

  it('round-trips a written settings object', async () => {
    const store = await freshStore();
    await store.setCrossoverSettings({
      ...DEFAULT_CROSSOVER_SETTINGS,
      recommendationStableSeconds: 60,
      chartTwsMaxKn: 25,
    });
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s.recommendationStableSeconds).toBe(60);
    expect(s.chartTwsMaxKn).toBe(25);
    expect(s.chartTwaMaxDeg).toBe(DEFAULT_CROSSOVER_SETTINGS.chartTwaMaxDeg);
  });

  it('reads with defaults merged in for partial stored rows', async () => {
    const path = `${tmpdir()}/crossover-settings-merge-${Date.now()}-${Math.random()}.db`;
    const seedStore = await ConfigStore.open(path);
    // Use the raw underlying SQLite to write a partial blob — only one field set.
    // This bypasses setCrossoverSettings(), so we actually test that the read
    // path on a fresh ConfigStore.open() merges DEFAULT_CROSSOVER_SETTINGS over
    // the partial stored row.
    const raw = new Database(path);
    raw
      .prepare(
        'INSERT INTO crossover_settings (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
      )
      .run(seedStore.activeBoatId, JSON.stringify({ forecastDurationHours: 24 }));
    raw.close();
    await seedStore.close();

    const store = await ConfigStore.open(path);
    stores.push(store);
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s.forecastDurationHours).toBe(24);
    expect(s.forecastIntervalMinutes).toBe(30);
    expect(s.recommendationStableSeconds).toBe(30);
  });
});
