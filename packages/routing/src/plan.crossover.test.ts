import { describe, it, expect } from 'vitest';
import type { CrossoverMap, PolarTable, SailWardrobe } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import type { PlanInput, RouteLeg } from './types.js';
import { plan } from './plan.js';

// Minimal world: constant 10 m/s easterly wind everywhere, 1° grid, no land.
function tinyWind(): PlanInput['wind'] {
  return {
    source: 'TEST',
    bbox: { minLat: 30, minLon: -70, maxLat: 35, maxLon: -65 },
    grid: { dLat: 0.5, dLon: 0.5 },
    samples: (lat: number, lon: number, t: number) => ({
      uMs: 10, // wind FROM east blowing west (negative-x). u positive=eastward
      vMs: 0,
      tWall: t,
    }),
  } as never;
}

const polar: PolarTable = {
  twsBins: [3, 5, 7, 10, 13],
  twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
  boatSpeed: [
    [0, 2, 3, 2, 1],
    [0, 3, 4, 3, 2],
    [0, 4, 5, 4, 3],
    [0, 5, 6, 5, 4],
    [0, 6, 7, 6, 5],
  ],
};

const wardrobe: SailWardrobe = {
  boatId: 'sula',
  activeConfigId: 'jib',
  activeMode: 'default',
  configs: [
    { id: 'jib', name: 'Jib', modes: {} },
    { id: 'spin', name: 'Spinnaker', modes: {} },
  ],
};

describe('plan() with crossover decoration', () => {
  it('decorates legs with recommendedConfigId from the crossover map', () => {
    const map: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: {},
      updatedAt: 0,
    };
    // Fill every cell with 'jib' so any leg is decorated
    for (let i = 0; i < polar.twsBins.length; i++) {
      for (let j = 0; j < polar.twaBins.length; j++) {
        map.cells[`${i},${j}`] = 'jib';
      }
    }
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
      crossover: { map, wardrobe },
    });
    expect(route.legs.length).toBeGreaterThan(0);
    expect(route.legs.every((l: RouteLeg) => l.configId === 'jib')).toBe(true);
  });

  it('legs at uncovered cells carry no configId', () => {
    const map: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: {}, // empty
      updatedAt: 0,
    };
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
      crossover: { map, wardrobe },
    });
    expect(route.legs.length).toBeGreaterThan(0);
    expect(route.legs.every((l) => l.configId === undefined)).toBe(true);
  });

  it('without crossover input, legs have no configId field', () => {
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
    });
    expect(route.legs.every((l) => l.configId === undefined)).toBe(true);
  });
});
