import { describe, it, expect } from 'vitest';
import { buildRtofsUrl } from './fetch-rtofs.js';

describe('buildRtofsUrl', () => {
  it('formats a 2d subset URL for UOGRD/VOGRD', () => {
    const u = buildRtofsUrl({
      runDateUtc: '2026-05-12',
      forecastHour: 24,
      bbox: { latMin: 30, latMax: 35, lonMin: -75, lonMax: -65 },
    });
    expect(u).toContain('filter_rtofs_2d.pl');
    expect(u).toContain('var_UOGRD=on');
    expect(u).toContain('var_VOGRD=on');
    expect(u).toContain('lev_surface=on');
    expect(u).toContain('subregion=&toplat=35&leftlon=-75&rightlon=-65&bottomlat=30');
  });

  it('zero-pads forecast hour to 3 digits and uses dir/file pattern', () => {
    const u = buildRtofsUrl({
      runDateUtc: '2026-05-12',
      forecastHour: 3,
      bbox: { latMin: 30, latMax: 35, lonMin: -75, lonMax: -65 },
    });
    expect(u).toContain('dir=%2Frtofs.20260512');
    expect(u).toContain('file=rtofs_glo_2ds_f003_diag.nc');
  });
});
