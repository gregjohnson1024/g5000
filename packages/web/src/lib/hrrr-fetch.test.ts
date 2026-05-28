import { describe, expect, it } from 'vitest';
import { buildHrrrUrl, pickHrrrRun, hrrrHorizonHours, inHrrrDomain } from './hrrr-fetch.js';

describe('hrrr helpers', () => {
  it('buildHrrrUrl targets filter_hrrr_2d with conus dir, 10 m wind, bbox subregion', () => {
    const u = new URL(
      buildHrrrUrl({
        runDateUtc: '2026-05-27',
        runHourUtc: 12,
        forecastHour: 3,
        bbox: { latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 },
      }),
    );
    expect(u.pathname).toContain('filter_hrrr_2d.pl');
    expect(u.searchParams.get('dir')).toBe('/hrrr.20260527/conus');
    expect(u.searchParams.get('file')).toBe('hrrr.t12z.wrfsfcf03.grib2');
    expect(u.searchParams.get('var_UGRD')).toBe('on');
    expect(u.searchParams.get('var_VGRD')).toBe('on');
    expect(u.searchParams.get('lev_10_m_above_ground')).toBe('on');
    expect(u.searchParams.get('subregion')).toBe('');
    expect(u.searchParams.get('toplat')).toBe('42');
  });

  it('pickHrrrRun lags ~2 h and picks the hourly run', () => {
    // 2026-05-27T15:10Z → with ~2h lag, the 13z run.
    const r = pickHrrrRun(Date.parse('2026-05-27T15:10:00Z') / 1000);
    expect(r.runDateUtc).toBe('2026-05-27');
    expect(r.runHourUtc).toBe(13);
  });

  it('hrrrHorizonHours: 18 h on off-hours, 48 h on synoptic runs', () => {
    expect(hrrrHorizonHours(13)).toBe(18);
    expect(hrrrHorizonHours(12)).toBe(48);
    expect(hrrrHorizonHours(0)).toBe(48);
  });

  it('inHrrrDomain rejects mid-ocean / non-US', () => {
    expect(inHrrrDomain({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 })).toBe(true); // RI
    expect(inHrrrDomain({ latMin: 30, latMax: 34, lonMin: -64, lonMax: -60 })).toBe(false); // Bermuda
  });
});
