import { describe, it, expect } from 'vitest';
import {
  findNearestCalCell,
  applyAngleCorrectionToCell,
} from './find-cell.js';
import { DEFAULT_AWS_AWA_CAL } from '@h6000/db';

describe('findNearestCalCell', () => {
  const cal = DEFAULT_AWS_AWA_CAL;

  it('returns (0, 0) for AWS below all bins and AWA at 0', () => {
    const idx = findNearestCalCell(cal, 0.5, 0);
    expect(idx).toEqual({ awsIdx: 0, awaIdx: 0 });
  });

  it('returns the last indices for inputs above all bins', () => {
    const idx = findNearestCalCell(cal, 100, Math.PI * 2);
    expect(idx).toEqual({
      awsIdx: cal.awsBins.length - 1,
      awaIdx: cal.awaBins.length - 1,
    });
  });

  it('snaps to the nearest bin in each dimension', () => {
    const idx1 = findNearestCalCell(cal, 4.6, 0);
    expect(idx1.awsIdx).toBe(1); // closer to 4
    const idx2 = findNearestCalCell(cal, 5.4, 0);
    expect(idx2.awsIdx).toBe(2); // closer to 6
    const fiftyDeg = (50 * Math.PI) / 180;
    const idx3 = findNearestCalCell(cal, 6, fiftyDeg);
    expect(idx3.awaIdx).toBe(3); // closer to 45° than to 60°
  });
});

describe('applyAngleCorrectionToCell', () => {
  it('returns a new table with the targeted cell incremented by the delta', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    const next = applyAngleCorrectionToCell(cal, { awsIdx: 2, awaIdx: 4 }, 0.123);
    expect(next).not.toBe(cal);
    expect(next.angleCorrection[2]![4]).toBeCloseTo(0.123, 6);
    expect(next.angleCorrection[0]![0]).toBe(0);
    expect(next.angleCorrection[2]![3]).toBe(0);
  });

  it('does not mutate the input table', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    const before = cal.angleCorrection[1]![1];
    applyAngleCorrectionToCell(cal, { awsIdx: 1, awaIdx: 1 }, 0.5);
    expect(cal.angleCorrection[1]![1]).toBe(before);
  });

  it('throws on an out-of-range cell index', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    expect(() =>
      applyAngleCorrectionToCell(cal, { awsIdx: 999, awaIdx: 0 }, 0.1),
    ).toThrow();
    expect(() =>
      applyAngleCorrectionToCell(cal, { awsIdx: 0, awaIdx: -1 }, 0.1),
    ).toThrow();
  });
});
