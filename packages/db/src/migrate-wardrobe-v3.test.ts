import { describe, expect, it } from 'vitest';
import { migrateWardrobeV2toV3, type V2Wardrobe } from './migrate-wardrobe-v3.js';
import type { PolarTable } from './defaults.js';

const SAMPLE_POLAR: PolarTable = {
  twsBins: [3.086, 4.115, 5.144, 6.173, 7.202, 8.231, 10.289, 12.346], // 6,8,10,12,14,16,20,24 kn in m/s
  twaBins: [0.524, 0.785, 1.047, 1.309, 1.571, 2.094, 2.618, 3.142], // 30,45,60,75,90,120,150,180 deg in rad
  boatSpeed: Array.from({ length: 8 }, () => new Array(8).fill(0)),
};

describe('migrateWardrobeV2toV3', () => {
  it('splits one v2 config into atomic sails', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        {
          id: 'j0-full',
          name: 'J0 + Full',
          headsail: 'J0',
          mainState: 'Full',
          modes: {},
        },
      ],
      activeConfigId: 'j0-full',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.sails.map((s) => ({ id: s.id, category: s.category }))).toEqual([
      { id: 'j0', category: 'headsail' },
      { id: 'full-main', category: 'main' },
    ]);
    expect(v3.active).toEqual({ headsail: 'j0', main: 'full-main' });
  });

  it('dedupes sails across configs', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        { id: 'a', name: 'J0 + Full', headsail: 'J0', mainState: 'Full', modes: {} },
        { id: 'b', name: 'J0 + Reef1', headsail: 'J0', mainState: 'Reef1', modes: {} },
      ],
      activeConfigId: 'a',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    const ids = v3.sails.map((s) => s.id).sort();
    expect(ids).toEqual(['full-main', 'j0', 'reef1']);
  });

  it('remaps crossover_map cells into atomic regions', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        {
          id: 'stj-reef1',
          name: 'STJ + Reef1',
          headsail: 'STJ',
          mainState: 'Reef1',
          modes: {},
        },
      ],
      activeConfigId: 'stj-reef1',
      activeMode: 'default',
    };
    // Polar-bin cell (twsIdx=2, twaIdx=2) means TWS=10 kn, TWA=60°.
    // Fixed-grid cell for the same point: twsIdx=10, twaIdx=12.
    const map = {
      boatId: 'sula' as const,
      mode: 'default' as const,
      cells: { '2,2': 'stj-reef1' },
      updatedAt: 0,
    };
    const v3 = migrateWardrobeV2toV3(v2, map, SAMPLE_POLAR);
    const stj = v3.sails.find((s) => s.id === 'stj');
    const reef1 = v3.sails.find((s) => s.id === 'reef1');
    expect(stj?.region.cells).toContain('10,12');
    expect(reef1?.region.cells).toContain('10,12');
  });

  it('handles v2 with no crossover_map', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [{ id: 'a', name: 'A', headsail: 'A2', modes: {} }],
      activeConfigId: 'a',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    expect(v3.sails).toHaveLength(1);
    expect(v3.sails[0]!.region.cells).toEqual([]);
  });

  it('returns input unchanged if already v3', () => {
    const v3In = {
      schemaVersion: 3 as const,
      boatId: 'sula' as const,
      sails: [],
      active: {},
      activeMode: 'default' as const,
    };
    const v3Out = migrateWardrobeV2toV3(v3In, null, SAMPLE_POLAR);
    expect(v3Out).toEqual(v3In);
  });
});
