import { describe, it, expect } from 'vitest';
import { buildEcmwfUrls, pickEcmwfRun } from './fetch-ecmwf.js';

describe('buildEcmwfUrls', () => {
  it('builds full + index URLs for a step', () => {
    const u = buildEcmwfUrls({ runDateUtc: '2026-05-12', runHourUtc: 0, forecastHour: 3 });
    expect(u.grib).toBe(
      'https://data.ecmwf.int/forecasts/20260512/00z/ifs/0p25/oper/20260512000000-3h-oper-fc.grib2',
    );
    expect(u.index).toBe(
      'https://data.ecmwf.int/forecasts/20260512/00z/ifs/0p25/oper/20260512000000-3h-oper-fc.index',
    );
  });

  it('zero-pads run hour', () => {
    const u = buildEcmwfUrls({ runDateUtc: '2026-05-12', runHourUtc: 6, forecastHour: 0 });
    expect(u.grib).toContain('/06z/ifs/0p25/oper/20260512060000-0h-oper-fc.grib2');
  });

  it('handles double-digit forecast hour', () => {
    const u = buildEcmwfUrls({ runDateUtc: '2026-05-12', runHourUtc: 12, forecastHour: 144 });
    expect(u.grib).toContain('20260512120000-144h-oper-fc.grib2');
  });
});

describe('pickEcmwfRun', () => {
  it('uses 6-hourly runs with ~9h lag', () => {
    // 2026-05-12 12:00Z → minus 9h = 03:00Z → run hour = floor(3/6)*6 = 0.
    const at = Date.UTC(2026, 4, 12, 12, 0, 0) / 1000;
    const r = pickEcmwfRun(at);
    expect(r.runDateUtc).toBe('2026-05-12');
    expect(r.runHourUtc).toBe(0);
  });

  it('picks the 00z run at 13:00Z (06z is only 7h old → not yet disseminated)', () => {
    // 2026-05-12 13:00Z → minus 9h = 04:00Z → run hour = floor(4/6)*6 = 0.
    const at = Date.UTC(2026, 4, 12, 13, 0, 0) / 1000;
    const r = pickEcmwfRun(at);
    expect(r.runDateUtc).toBe('2026-05-12');
    expect(r.runHourUtc).toBe(0);
  });

  it('rolls back across midnight UTC', () => {
    // 2026-05-12 03:00Z → minus 9h = 2026-05-11 18:00Z → run hour = floor(18/6)*6 = 18.
    const at = Date.UTC(2026, 4, 12, 3, 0, 0) / 1000;
    const r = pickEcmwfRun(at);
    expect(r.runDateUtc).toBe('2026-05-11');
    expect(r.runHourUtc).toBe(18);
  });
});
