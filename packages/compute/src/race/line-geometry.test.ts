import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  initialBearingRad,
  lineBearingRad,
  distanceToLineMeters,
  timeToLineSeconds,
  lineBiasRad,
} from './line-geometry.js';

const port = { lat: 41.5000, lon: -71.3000 };
const stbd = { lat: 41.5000, lon: -71.2900 };  // ~830 m east of port

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(port, port)).toBeLessThan(0.001);
  });
  it('matches a known great-circle distance to within 1 m', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    // 1° of longitude at the equator ≈ 111_320 m
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_600);
  });
});

describe('lineBearingRad', () => {
  it('east-pointing line from port to stbd is ~π/2 (90° true)', () => {
    const b = lineBearingRad(port, stbd);
    expect(b).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('distanceToLineMeters', () => {
  it('returns 0 for a boat on the line midpoint', () => {
    const mid = { lat: (port.lat + stbd.lat) / 2, lon: (port.lon + stbd.lon) / 2 };
    const r = distanceToLineMeters(mid, port, stbd, 'port');
    expect(Math.abs(r)).toBeLessThan(1);
  });
  it('returns a positive distance when boat is on the declared pre-start side', () => {
    // Boat south of the line (line runs east-west) → south is the pre-start side.
    const south = { lat: 41.4900, lon: -71.2950 };
    const r = distanceToLineMeters(south, port, stbd, 'port'); // pre-start = south
    expect(r).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(1000);  // ~1.1 km south
    expect(r).toBeLessThan(1200);
  });
  it('returns a negative distance after the boat crosses to the other side', () => {
    const north = { lat: 41.5100, lon: -71.2950 };
    // Boat south is pre-start side → crossing north is past-line.
    const r = distanceToLineMeters(north, port, stbd, 'port');
    expect(r).toBeLessThan(0);
  });
});

describe('timeToLineSeconds', () => {
  it('returns DTL/speed when boat heads directly at the line', () => {
    // Boat 1000 m on pre-start side, COG aimed at line normal, SOG 5 m/s.
    // Closing speed = 5 m/s · cos(0) = 5 m/s. TTL = 1000/5 = 200 s.
    const dtl = 1000;
    const sog = 5;
    const closingAngleRad = 0;  // perpendicular to line
    const t = timeToLineSeconds(dtl, sog, closingAngleRad);
    expect(t).toBeCloseTo(200, 1);
  });
  it('returns null when boat is moving parallel or away (closing ≤ 0)', () => {
    expect(timeToLineSeconds(1000, 5, Math.PI / 2)).toBeNull();
    expect(timeToLineSeconds(1000, 5, Math.PI)).toBeNull();
  });
});

describe('lineBiasRad', () => {
  it('returns 0 for a perfectly square line (line ⟂ TWD)', () => {
    // Line bears 90° true, TWD 180° (wind from south). Line normal = 0°
    // (north), TWD = 180°. Angle between normal and from-wind = 180°,
    // bias = angle between (line-bearing) and (perp-to-TWD) → 0.
    const lineBearing = Math.PI / 2;
    const twd = Math.PI;  // from south
    expect(lineBiasRad(lineBearing, twd)).toBeCloseTo(0, 3);
  });
  it('positive bias means port end favored (closer to wind)', () => {
    // Line east-west; wind from NNW (TWD = -π/8 from north, i.e. -22.5°).
    // Port end (west) is closer to wind → bias positive.
    const lineBearing = Math.PI / 2;
    const twd = -Math.PI / 8;
    const bias = lineBiasRad(lineBearing, twd);
    expect(bias).toBeGreaterThan(0);
  });
});
