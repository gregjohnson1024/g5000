import { describe, expect, it } from 'vitest';
import { fmtDistanceNm, sortByDistanceNm } from './station-distance';

interface Stn {
  id: string;
  lat: number;
  lon: number;
}

const HALIFAX: Stn = { id: 'halifax', lat: 44.6488, lon: -63.5752 };
const SAINT_JOHN: Stn = { id: 'saint-john', lat: 45.2733, lon: -66.0633 };
const VANCOUVER: Stn = { id: 'vancouver', lat: 49.2827, lon: -123.1207 };

describe('sortByDistanceNm', () => {
  it('sorts closest-first from the fix and annotates distances in NM', () => {
    // Fix just off Halifax.
    const fix = { lat: 44.6, lon: -63.5 };
    const out = sortByDistanceNm([VANCOUVER, SAINT_JOHN, HALIFAX], fix, (s) => s);
    expect(out.map((e) => e.item.id)).toEqual(['halifax', 'saint-john', 'vancouver']);
    for (const e of out) {
      expect(e.distanceNm).not.toBeNull();
      expect(e.distanceNm).toBeGreaterThan(0);
    }
    // Halifax is a handful of NM away; Vancouver is transcontinental.
    expect(out[0]!.distanceNm!).toBeLessThan(10);
    expect(out[2]!.distanceNm!).toBeGreaterThan(1000);
  });

  it('computes ~60 NM per degree of latitude', () => {
    const fix = { lat: 44, lon: -63 };
    const oneDegNorth: Stn = { id: 'n', lat: 45, lon: -63 };
    const out = sortByDistanceNm([oneDegNorth], fix, (s) => s);
    expect(out[0]!.distanceNm!).toBeCloseTo(60, 0);
  });

  it('preserves original order with all-null distances when there is no fix', () => {
    const out = sortByDistanceNm([VANCOUVER, SAINT_JOHN, HALIFAX], null, (s) => s);
    expect(out.map((e) => e.item.id)).toEqual(['vancouver', 'saint-john', 'halifax']);
    expect(out.every((e) => e.distanceNm === null)).toBe(true);
  });

  it('treats a non-finite fix as no fix', () => {
    const out = sortByDistanceNm([VANCOUVER, HALIFAX], { lat: NaN, lon: -63 }, (s) => s);
    expect(out.map((e) => e.item.id)).toEqual(['vancouver', 'halifax']);
    expect(out.every((e) => e.distanceNm === null)).toBe(true);
  });

  it('sorts stations with non-finite coordinates last, order preserved', () => {
    const fix = { lat: 44.6, lon: -63.5 };
    const badA: Stn = { id: 'bad-a', lat: NaN, lon: -63 };
    const badB: Stn = { id: 'bad-b', lat: 44, lon: Infinity };
    const out = sortByDistanceNm([badA, VANCOUVER, badB, HALIFAX], fix, (s) => s);
    expect(out.map((e) => e.item.id)).toEqual(['halifax', 'vancouver', 'bad-a', 'bad-b']);
    expect(out[2]!.distanceNm).toBeNull();
    expect(out[3]!.distanceNm).toBeNull();
  });

  it('returns an empty array for an empty list', () => {
    expect(sortByDistanceNm([], { lat: 44, lon: -63 }, (s: Stn) => s)).toEqual([]);
  });
});

describe('fmtDistanceNm', () => {
  it('formats to one decimal with an NM suffix', () => {
    expect(fmtDistanceNm(12.34)).toBe('12.3 NM');
    expect(fmtDistanceNm(0)).toBe('0.0 NM');
    expect(fmtDistanceNm(1234.567)).toBe('1234.6 NM');
  });

  it('returns an empty string for null', () => {
    expect(fmtDistanceNm(null)).toBe('');
  });
});
