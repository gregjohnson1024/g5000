import { describe, it, expect } from 'vitest';
import {
  NUMBER_FIELDS,
  DEFAULT_SETTINGS,
  isInRange,
  isModified,
  mergeWithDefaults,
  validateAll,
} from './race-settings-defs.js';

describe('NUMBER_FIELDS', () => {
  it('exposes three numeric fields with sane ranges', () => {
    expect(NUMBER_FIELDS).toHaveLength(3);
    const keys = NUMBER_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(['laylineDistanceNm', 'ocsLookAheadSec', 'shiftThresholdDeg']);
    // Spec says layline distance is capped at 15 NM.
    const layline = NUMBER_FIELDS.find((f) => f.key === 'laylineDistanceNm')!;
    expect(layline.max).toBe(15);
  });
  it('every field default falls inside its own range', () => {
    for (const f of NUMBER_FIELDS) {
      expect(f.defaultValue).toBeGreaterThanOrEqual(f.min);
      expect(f.defaultValue).toBeLessThanOrEqual(f.max);
    }
  });
});

describe('isInRange', () => {
  const field = NUMBER_FIELDS[0]!; // shiftThresholdDeg: 1–30
  it('returns true for values inside the range', () => {
    expect(isInRange(field, 1)).toBe(true);
    expect(isInRange(field, 15)).toBe(true);
    expect(isInRange(field, 30)).toBe(true);
  });
  it('returns false for values outside the range', () => {
    expect(isInRange(field, 0)).toBe(false);
    expect(isInRange(field, 31)).toBe(false);
    expect(isInRange(field, -5)).toBe(false);
  });
  it('returns false for NaN / Infinity (catches empty-input case)', () => {
    expect(isInRange(field, NaN)).toBe(false);
    expect(isInRange(field, Infinity)).toBe(false);
    expect(isInRange(field, -Infinity)).toBe(false);
  });
});

describe('isModified', () => {
  it('returns false when objects are deeply equal', () => {
    expect(isModified(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(false);
  });
  it('returns true when any number field differs', () => {
    expect(isModified(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, shiftThresholdDeg: 12 })).toBe(true);
    expect(isModified(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ocsLookAheadSec: 5 })).toBe(true);
    expect(isModified(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, laylineDistanceNm: 8 })).toBe(true);
  });
  it('returns true when the boolean differs', () => {
    expect(isModified(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, integrateCurrent: false })).toBe(
      true,
    );
  });
});

describe('mergeWithDefaults', () => {
  it('returns defaults when input is undefined', () => {
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it('preserves provided keys and fills the rest from defaults', () => {
    const out = mergeWithDefaults({ shiftThresholdDeg: 12 });
    expect(out.shiftThresholdDeg).toBe(12);
    expect(out.ocsLookAheadSec).toBe(DEFAULT_SETTINGS.ocsLookAheadSec);
    expect(out.laylineDistanceNm).toBe(DEFAULT_SETTINGS.laylineDistanceNm);
    expect(out.integrateCurrent).toBe(DEFAULT_SETTINGS.integrateCurrent);
  });
  it('preserves integrateCurrent=false (the truthy fallback case)', () => {
    // `?? DEFAULT.integrateCurrent` (which is true) must NOT clobber an
    // explicit false. Use of `??` not `||` is the load-bearing detail.
    const out = mergeWithDefaults({ integrateCurrent: false });
    expect(out.integrateCurrent).toBe(false);
  });
});

describe('validateAll', () => {
  it('returns [] for the defaults', () => {
    expect(validateAll(DEFAULT_SETTINGS)).toEqual([]);
  });
  it('lists exactly one error per out-of-range field', () => {
    const errs = validateAll({
      shiftThresholdDeg: 100,
      ocsLookAheadSec: 1, // below min 3
      laylineDistanceNm: 20, // above max 15
      integrateCurrent: true,
    });
    expect(errs).toHaveLength(3);
    expect(errs.some((e) => e.includes('Wind shift'))).toBe(true);
    expect(errs.some((e) => e.includes('OCS'))).toBe(true);
    expect(errs.some((e) => e.includes('Layline'))).toBe(true);
  });
  it('error string mentions the unit', () => {
    const errs = validateAll({ ...DEFAULT_SETTINGS, laylineDistanceNm: 99 });
    expect(errs[0]).toContain('NM');
    expect(errs[0]).toContain('1–15');
  });
});
