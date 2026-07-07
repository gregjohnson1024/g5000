import { describe, it, expect } from 'vitest';
import {
  parseCoordinate,
  parseLatLon,
  formatCoordinate,
  fmtLatDmm,
  fmtLonDmm,
  fmtLatLonDmm,
} from './coords';

// ---------------------------------------------------------------------------
// parseCoordinate
// ---------------------------------------------------------------------------
describe('parseCoordinate', () => {
  it('parses signed decimal', () => {
    expect(parseCoordinate('41.76497')).toBeCloseTo(41.76497);
    expect(parseCoordinate('-71.1285')).toBeCloseTo(-71.1285);
  });

  it('parses hemisphere letter', () => {
    expect(parseCoordinate('41.76497 N')).toBeCloseTo(41.76497);
    expect(parseCoordinate('71.1285 W')).toBeCloseTo(-71.1285);
  });

  it('parses DMS', () => {
    expect(parseCoordinate('41°45\'53.9"N')).toBeCloseTo(41.765);
    expect(parseCoordinate('71°07\'42.6"W')).toBeCloseTo(-71.1285);
  });

  it('parses DMM', () => {
    expect(parseCoordinate("41° 45.898' N")).toBeCloseTo(41.76497);
  });

  it('throws on empty input', () => {
    expect(() => parseCoordinate('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseLatLon
// ---------------------------------------------------------------------------
describe('parseLatLon', () => {
  it('parses comma-separated decimal pair', () => {
    const { lat, lon } = parseLatLon('41.76497, -71.1285');
    expect(lat).toBeCloseTo(41.76497);
    expect(lon).toBeCloseTo(-71.1285);
  });

  it('parses slash-separated pair', () => {
    const { lat, lon } = parseLatLon('41.76497/-71.1285');
    expect(lat).toBeCloseTo(41.76497);
    expect(lon).toBeCloseTo(-71.1285);
  });
});

// ---------------------------------------------------------------------------
// formatCoordinate — DMM with symbols: `41° 45.898' N`
// This is distinct from the compact fmtLatLonDmm format.
// ---------------------------------------------------------------------------
describe('formatCoordinate', () => {
  it('formats DMM with degree/prime symbols and uppercase hemisphere', () => {
    // Lock the shape: `41° 45.898' N`
    const result = formatCoordinate(41.76497, 'lat', { format: 'dmm', precision: 3 });
    expect(result).toBe("41° 45.898' N");
  });

  it('formats southern latitude', () => {
    const result = formatCoordinate(-33.7, 'lat', { format: 'dmm', precision: 3 });
    expect(result).toBe("33° 42.000' S");
  });

  it('formats western longitude', () => {
    const result = formatCoordinate(-66.428, 'lon', { format: 'dmm', precision: 3 });
    expect(result).toMatch(/W$/);
  });

  it('returns em-dash for non-finite', () => {
    expect(formatCoordinate(NaN, 'lat', { format: 'dmm' })).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// fmtLatDmm / fmtLonDmm — DmmParts struct
// ---------------------------------------------------------------------------
describe('fmtLatDmm', () => {
  it('returns correct parts for northern latitude', () => {
    const parts = fmtLatDmm(33.704);
    expect(parts.hemi).toBe('N');
    expect(parts.deg).toBe(33);
    // (0.704 * 60 = 42.24)
    expect(Number(parts.min)).toBeCloseTo(42.24, 1);
  });

  it('returns S hemi for negative latitude', () => {
    expect(fmtLatDmm(-33.704).hemi).toBe('S');
  });
});

describe('fmtLonDmm', () => {
  it('returns W hemi for negative longitude', () => {
    const parts = fmtLonDmm(-66.428);
    expect(parts.hemi).toBe('W');
    expect(parts.deg).toBe(66);
  });

  it('returns E hemi for positive longitude', () => {
    expect(fmtLonDmm(9.1).hemi).toBe('E');
  });
});

// ---------------------------------------------------------------------------
// fmtLatLonDmm — compact marine format: `33 42.232n 66 25.240w`
// CRITICAL: lock the exact shape (no symbols, lowercase hemi, space-separated)
// ---------------------------------------------------------------------------
describe('fmtLatLonDmm', () => {
  it('produces compact marine DMM format', () => {
    // 33.704°N, 66.4206°W → "33 42.240n 66 25.236w" (rounded to 3dp)
    const result = fmtLatLonDmm(33.704, -66.4206);
    // Shape assertion: no degree symbol, no prime, lowercase hemi
    expect(result).not.toContain('°');
    expect(result).not.toContain("'");
    expect(result).toMatch(/^\d+ \d+\.\d{3}[ns] \d+ \d+\.\d{3}[ew]$/);
  });

  it('matches canonical example from keep-list: `33 42.232n 66 25.240w` shape', () => {
    // Verify lat=33, degrees=33, lon degrees=66, lowercase n and w hemispheres
    const result = fmtLatLonDmm(33.70387, -66.42067);
    const parts = result.split(' ');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('33');
    expect(parts[2]).toBe('66');
    expect(parts[1]!.endsWith('n')).toBe(true);
    expect(parts[3]!.endsWith('w')).toBe(true);
  });

  it('is distinct from formatCoordinate DMM (no symbols, lowercase, paired)', () => {
    const compact = fmtLatLonDmm(41.76497, -71.1285);
    const symbolic = formatCoordinate(41.76497, 'lat', { format: 'dmm', precision: 3 });
    // compact has no degree symbol; symbolic does
    expect(compact).not.toContain('°');
    expect(symbolic).toContain('°');
    // compact is lowercase; symbolic is uppercase
    expect(compact).toMatch(/n|s/);
    expect(symbolic).toMatch(/N|S/);
  });
});
