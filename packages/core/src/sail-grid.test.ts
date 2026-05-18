import { describe, expect, it } from 'vitest';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWS_STEP_KN,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
  snapToFixedGrid,
  cellKey,
  parseCellKey,
} from './sail-grid';

const MPS_PER_KN = 0.514444;

describe('sail-grid constants', () => {
  it('defines 41 TWS bins at 1 kn step (0..40 kn)', () => {
    expect(SAIL_GRID_TWS_BINS).toBe(41);
    expect(SAIL_GRID_TWS_STEP_KN).toBe(1);
  });
  it('defines 37 TWA bins at 5° step (0..180°)', () => {
    expect(SAIL_GRID_TWA_BINS).toBe(37);
    expect(SAIL_GRID_TWA_STEP_DEG).toBe(5);
  });
});

describe('snapToFixedGrid', () => {
  it('snaps origin to (0, 0)', () => {
    const r = snapToFixedGrid({ twsMs: 0, twaRad: 0 });
    expect(r.twsIdx).toBe(0);
    expect(r.twaIdx).toBe(0);
  });
  it('snaps 10 kn (5.144 m/s) and 45° (π/4 rad) to (10, 9)', () => {
    const r = snapToFixedGrid({ twsMs: 10 * MPS_PER_KN, twaRad: Math.PI / 4 });
    expect(r.twsIdx).toBe(10);
    expect(r.twaIdx).toBe(9); // 45 / 5
  });
  it('clamps TWS above 40 kn to 40', () => {
    const r = snapToFixedGrid({ twsMs: 60 * MPS_PER_KN, twaRad: 0 });
    expect(r.twsIdx).toBe(40);
  });
  it('clamps negative TWS to 0', () => {
    const r = snapToFixedGrid({ twsMs: -5, twaRad: 0 });
    expect(r.twsIdx).toBe(0);
  });
  it('clamps TWA above 180° to bin 36', () => {
    const r = snapToFixedGrid({ twsMs: 0, twaRad: Math.PI + 0.1 });
    expect(r.twaIdx).toBe(36);
  });
  it('folds negative TWA to its absolute magnitude (port/starboard symmetric)', () => {
    // −0.5 rad ≈ 28.6° → bin 6 (28.6/5 rounds to 6)
    const r = snapToFixedGrid({ twsMs: 0, twaRad: -0.5 });
    expect(r.twaIdx).toBe(6);
  });
  it('snaps -45° (negative π/4 rad) to the same bin as +45° (bin 9)', () => {
    const a = snapToFixedGrid({ twsMs: 0, twaRad: -Math.PI / 4 });
    const b = snapToFixedGrid({ twsMs: 0, twaRad: Math.PI / 4 });
    expect(a.twaIdx).toBe(9);
    expect(a.twaIdx).toBe(b.twaIdx);
  });
  it('round-trips through cellKey', () => {
    expect(cellKey({ twsIdx: 12, twaIdx: 9 })).toBe('12,9');
  });
});

describe('parseCellKey', () => {
  it('parses a valid in-bounds key', () => {
    expect(parseCellKey('12,9')).toEqual({ twsIdx: 12, twaIdx: 9 });
  });
  it('returns null for malformed input', () => {
    expect(parseCellKey('foo')).toBeNull();
  });
  it('returns null for out-of-bounds twsIdx', () => {
    expect(parseCellKey('41,9')).toBeNull();
  });
  it('returns null for out-of-bounds twaIdx', () => {
    expect(parseCellKey('12,37')).toBeNull();
  });
});
