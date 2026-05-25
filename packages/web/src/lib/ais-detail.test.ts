import { describe, it, expect } from 'vitest';
import { fmtTcpa, aisDetailRows } from './ais-detail';
import type { AisTarget } from '@g5000/core';
import type { CpaResult } from '@g5000/compute';

describe('fmtTcpa', () => {
  it('formats minutes:seconds', () => expect(fmtTcpa(125)).toBe('2:05'));
  it('reports "past" for a negative tcpa', () => expect(fmtTcpa(-5)).toBe('past'));
  it('reports "—" for non-finite', () => expect(fmtTcpa(NaN)).toBe('—'));
});

describe('aisDetailRows', () => {
  it('formats COG/SOG and uses cpa for range/cpa/tcpa', () => {
    const t: AisTarget = {
      mmsi: 123456789,
      vesselClass: 'A',
      name: 'TEST',
      cog: Math.PI / 2, // 90°
      sog: 5.144444, // ~10 kn
      lastSeenMs: 0,
    };
    const cpa: CpaResult = {
      rangeMeters: 1852 * 3,
      cpaMeters: 1852 * 0.5,
      tcpaSeconds: 600,
      bearingRadians: 0,
      cpaRelativeEast: 0,
      cpaRelativeNorth: 0,
    };
    const rows = Object.fromEntries(aisDetailRows(t, cpa));
    expect(rows['MMSI']).toBe('123456789');
    expect(rows['Name']).toBe('TEST');
    expect(rows['Class']).toBe('A');
    expect(rows['COG']).toBe('90°');
    expect(rows['SOG']).toBe('10.0 kn');
    expect(rows['Range']).toBe('3.00 NM');
    expect(rows['CPA']).toBe('0.50 NM');
    expect(rows['TCPA']).toBe('10:00');
  });

  it('shows "—" for missing fields and a null cpa', () => {
    const t: AisTarget = { mmsi: 1, vesselClass: 'unknown', lastSeenMs: 0 };
    const rows = Object.fromEntries(aisDetailRows(t, null));
    expect(rows['Name']).toBe('—');
    expect(rows['COG']).toBe('—');
    expect(rows['SOG']).toBe('—');
    expect(rows['Range']).toBe('—');
    expect(rows['CPA']).toBe('—');
    expect(rows['TCPA']).toBe('—');
  });
});
