import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
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

  it('partial writes merge with defaults', async () => {
    const store = await freshStore();
    await store.setCrossoverSettings({
      ...DEFAULT_CROSSOVER_SETTINGS,
      forecastDurationHours: 24,
    });
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s.forecastDurationHours).toBe(24);
    expect(s.forecastIntervalMinutes).toBe(30);
  });
});
