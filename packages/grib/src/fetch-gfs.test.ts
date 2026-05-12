import { describe, it, expect } from 'vitest';
import {
  buildGfsUrl,
  pickGfsRunForDeparture,
  gfsForecastHoursForRange,
} from './fetch-gfs.js';
import type { Bbox } from './types.js';

const BBOX: Bbox = { latMin: 30, latMax: 40, lonMin: -75, lonMax: -65 };

describe('buildGfsUrl', () => {
  it('formats a 0.25° subset URL for u10/v10', () => {
    const url = buildGfsUrl({
      runDateUtc: '2026-05-12',
      runHourUtc: 12,
      forecastHour: 6,
      variables: ['UGRD', 'VGRD'],
      bbox: BBOX,
    });
    expect(url).toMatch(/^https:\/\/nomads\.ncep\.noaa\.gov\/cgi-bin\/filter_gfs_0p25\.pl/);
    expect(url).toContain('dir=%2Fgfs.20260512%2F12%2Fatmos');
    expect(url).toContain('file=gfs.t12z.pgrb2.0p25.f006');
    expect(url).toContain('var_UGRD=on');
    expect(url).toContain('var_VGRD=on');
    expect(url).toContain('lev_10_m_above_ground=on');
    expect(url).toContain('subregion=&toplat=40&leftlon=-75&rightlon=-65&bottomlat=30');
  });

  it('zero-pads forecast hour to 3 digits', () => {
    const u = buildGfsUrl({
      runDateUtc: '2026-05-12', runHourUtc: 0,
      forecastHour: 96, variables: ['UGRD'], bbox: BBOX,
    });
    expect(u).toContain('f096');
  });
});

describe('pickGfsRunForDeparture', () => {
  it('uses the most recent 6-hour run that is at least 4 hours old', () => {
    // 2026-05-12 10:00Z → most recent run is 06z (4h old). 12z run isn't out yet.
    const at = Date.UTC(2026, 4, 12, 10, 0, 0) / 1000;
    const r = pickGfsRunForDeparture(at);
    expect(r.runDateUtc).toBe('2026-05-12');
    expect(r.runHourUtc).toBe(6);
  });

  it('rolls back across midnight', () => {
    // 2026-05-12 02:00Z → 18z run from the previous day (8h old).
    const at = Date.UTC(2026, 4, 12, 2, 0, 0) / 1000;
    const r = pickGfsRunForDeparture(at);
    expect(r.runDateUtc).toBe('2026-05-11');
    expect(r.runHourUtc).toBe(18);
  });
});

describe('gfsForecastHoursForRange', () => {
  it('produces 1-hourly steps up to f120, 3-hourly after', () => {
    const hours = gfsForecastHoursForRange({ startHour: 0, endHour: 132 });
    expect(hours[0]).toBe(0);
    expect(hours.includes(120)).toBe(true);
    expect(hours.includes(123)).toBe(true); // 3-hour grid after f120
    expect(hours.includes(121)).toBe(false);
    expect(hours[hours.length - 1]).toBe(132);
  });
});
