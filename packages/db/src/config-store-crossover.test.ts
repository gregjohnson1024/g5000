import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ConfigStore } from './config-store.js';
import { DEFAULT_CROSSOVER_MAP } from './defaults.js';

const stores: ConfigStore[] = [];

afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

async function freshStore(): Promise<ConfigStore> {
  const s = await ConfigStore.open(':memory:');
  stores.push(s);
  return s;
}

describe('ConfigStore — crossover map', () => {
  it('returns DEFAULT_CROSSOVER_MAP on a fresh store (active mode)', async () => {
    const store = await freshStore();
    const m = await firstValueFrom(store.crossoverMap$);
    expect(m.boatId).toBe(store.activeBoatId);
    expect(m.mode).toBe('default');
    expect(m.cells).toEqual({});
  });

  it('round-trips a written map', async () => {
    const store = await freshStore();
    await store.setCrossoverMap({
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,5': 'full-j1', '3,5': 'reef1-j2' },
      updatedAt: 1700000000,
    });
    const m = await firstValueFrom(store.crossoverMap$);
    expect(m.cells['2,5']).toBe('full-j1');
    expect(m.cells['3,5']).toBe('reef1-j2');
  });

  it('rejects a write whose mode mismatches active mode', async () => {
    const store = await freshStore();
    await expect(
      store.setCrossoverMap({
        boatId: store.activeBoatId,
        mode: 'planing',
        cells: {},
        updatedAt: 0,
      }),
    ).rejects.toThrow(/mode/);
  });

  it('rejects a write whose boatId mismatches active boat', async () => {
    const store = await freshStore();
    await expect(
      store.setCrossoverMap({
        boatId: 'someoneelse',
        mode: 'default',
        cells: {},
        updatedAt: 0,
      }),
    ).rejects.toThrow(/boat/);
  });
});

// Mark DEFAULT_CROSSOVER_MAP as used so tsc doesn't strip the import even
// though the tests build expected shapes inline.
void DEFAULT_CROSSOVER_MAP;
