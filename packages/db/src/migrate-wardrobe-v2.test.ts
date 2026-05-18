import { describe, it, expect } from 'vitest';
import { migrateWardrobeV1ToV2, isV1Wardrobe } from './migrate-wardrobe-v2.js';
import { DEFAULT_POLARS, type SailWardrobe, type PolarTable } from './defaults.js';

const RAW_V1 = {
  configs: [
    { id: 'default', name: 'Default', polar: DEFAULT_POLARS },
    { id: 'a2-set', name: 'A2 set', polar: DEFAULT_POLARS, downwindSail: 'A2' },
  ],
  activeConfigId: 'default',
};

const RAW_V2: SailWardrobe = {
  boatId: 'sula',
  configs: [
    { id: 'default', name: 'Default', modes: { default: { activeRevisionId: 'rev-X' } } },
  ],
  activeConfigId: 'default',
  activeMode: 'default',
};

describe('isV1Wardrobe', () => {
  it('returns true when any slot has an embedded polar', () => {
    expect(isV1Wardrobe(RAW_V1)).toBe(true);
  });

  it('returns false on a v2 shape', () => {
    expect(isV1Wardrobe(RAW_V2)).toBe(false);
  });
});

describe('migrateWardrobeV1ToV2', () => {
  const idGen = (() => {
    let n = 0;
    return () => `rev-${String(++n).padStart(2, '0')}`;
  })();
  const now = 1_700_000_000;

  it('produces one revision per v1 slot, points modes.default at it', () => {
    const out = migrateWardrobeV1ToV2(RAW_V1, 'sula', now, idGen);
    expect(out.revisions).toHaveLength(2);
    expect(out.revisions[0]!.sailConfigId).toBe('default');
    expect(out.revisions[0]!.mode).toBe('default');
    expect(out.revisions[0]!.lineage.kind).toBe('migrated');
    expect(out.v2.boatId).toBe('sula');
    expect(out.v2.activeMode).toBe('default');
    expect(out.v2.configs[0]!.modes.default!.activeRevisionId).toBe(out.revisions[0]!.id);
    // legacy `polar` is dropped on v2 slots
    expect((out.v2.configs[0] as Record<string, unknown>).polar).toBeUndefined();
  });

  it('uses the supplied fallback polar when a v1 slot is missing its polar', () => {
    const fallback: PolarTable = { twsBins: [3, 5], twaBins: [0, Math.PI], boatSpeed: [[0, 0], [0, 0]] };
    const idg = (() => {
      let n = 0;
      return () => `r-${++n}`;
    })();
    const noPolarSlot = { id: 'x', name: 'X' };
    const v1 = { configs: [noPolarSlot], activeConfigId: 'x' };
    const out = migrateWardrobeV1ToV2(v1, 'sula', now, idg, fallback);
    expect(out.revisions[0]!.table).toEqual(fallback);
  });

  it('is a no-op on an already-v2 wardrobe', () => {
    const out = migrateWardrobeV1ToV2(RAW_V2, 'sula', now, idGen);
    expect(out.revisions).toHaveLength(0);
    expect(out.v2).toEqual(RAW_V2);
  });
});
