import { describe, it, expect } from 'vitest';
import { projectLayline } from './laylines.js';
import type { CurrentField } from '@g5000/grib';

const startPos = { lat: 41.5, lon: -71.3 };

// 2-knot easterly current (u = +1.029 m/s, v = 0) across a small box.
// times in unix seconds (not ms); two entries required by interpolateCurrent
const REF_TIME_S = new Date('2026-05-18T12:00:00Z').getTime() / 1000;
const easterlyCurrent: CurrentField = {
  source: 'CMEMS',
  runTime: new Date('2026-05-18T00:00:00Z').getTime() / 1000,
  lats: [41.0, 42.0],
  lons: [-72.0, -71.0],
  times: [REF_TIME_S, REF_TIME_S + 3600],
  u: [
    [[1.029, 1.029], [1.029, 1.029]],
    [[1.029, 1.029], [1.029, 1.029]],
  ],
  v: [
    [[0, 0], [0, 0]],
    [[0, 0], [0, 0]],
  ],
};

describe('projectLayline (no current)', () => {
  it('returns a 2-point polyline when integrateCurrent=false', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0, // due north
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 2,
      integrateCurrent: false,
      timeAtSampleMs: Date.now(),
    });
    expect(poly).toHaveLength(2);
    expect(poly[0]).toEqual(startPos);
    // 2 NM north ≈ 0.0333° lat
    expect(poly[1]!.lat).toBeCloseTo(startPos.lat + 0.0333, 3);
    expect(poly[1]!.lon).toBeCloseTo(startPos.lon, 4);
  });
});

describe('projectLayline (with current)', () => {
  it('returns 21 points for a 5 NM projection (20 segments)', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 5,
      integrateCurrent: true,
      timeAtSampleMs: REF_TIME_S * 1000,
    });
    expect(poly).toHaveLength(21);
  });

  it('an easterly current bends a northbound layline to the east', () => {
    const noCurr = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 5,
      integrateCurrent: false,
      timeAtSampleMs: REF_TIME_S * 1000,
    });
    const withCurr = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 5,
      integrateCurrent: true,
      timeAtSampleMs: REF_TIME_S * 1000,
    });
    const endNoCurr = noCurr[noCurr.length - 1]!;
    const endWithCurr = withCurr[withCurr.length - 1]!;
    expect(endWithCurr.lon).toBeGreaterThan(endNoCurr.lon);
  });

  it('falls back to no-current behaviour when currentField is null', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: Math.PI / 2, // east
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 1,
      integrateCurrent: true, // requested but no field → ignored
      timeAtSampleMs: Date.now(),
    });
    expect(poly).toHaveLength(2);
  });

  it('caps segments at 20 even when requesting a long projection', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 100,
      integrateCurrent: true,
      timeAtSampleMs: REF_TIME_S * 1000,
    });
    expect(poly).toHaveLength(21);
  });
});
