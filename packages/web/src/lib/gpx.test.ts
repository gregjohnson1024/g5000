import { describe, it, expect } from 'vitest';
import { routeToGpx } from './gpx';
import type { Route } from '@g5000/routing';

const r: Route = {
  legs: [
    { t: 0, lat: 30, lon: -75, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 },
    { t: 3600, lat: 30, lon: -74, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 },
  ],
  start: 0,
  end: 3600,
  distance: 100000,
  model: 'GFS',
  usedCurrents: false,
  polarId: 'test',
};

describe('routeToGpx', () => {
  it('produces valid GPX 1.1 with one track + N trkpts', () => {
    const gpx = routeToGpx(r, 'Test Route');
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<name>Test Route</name>');
    expect(gpx).toContain('<trkpt lat="30" lon="-75">');
    expect(gpx).toContain('<trkpt lat="30" lon="-74">');
    expect(gpx).toContain('<time>1970-01-01T00:00:00.000Z</time>');
  });
});
