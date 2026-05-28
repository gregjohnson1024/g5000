import type { Bbox } from './wind-fetch';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl';

export interface BuildHrrrUrlOpts {
  runDateUtc: string; // YYYY-MM-DD
  runHourUtc: number; // 0..23
  forecastHour: number; // 0..18 (or ..48 on synoptic runs)
  bbox: Bbox;
}

export function buildHrrrUrl(o: BuildHrrrUrlOpts): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const ff = String(o.forecastHour).padStart(2, '0');
  const p = new URLSearchParams();
  p.set('dir', `/hrrr.${dateNoDash}/conus`);
  p.set('file', `hrrr.t${hh}z.wrfsfcf${ff}.grib2`);
  p.set('var_UGRD', 'on');
  p.set('var_VGRD', 'on');
  p.set('lev_10_m_above_ground', 'on');
  p.set('subregion', '');
  p.set('toplat', String(o.bbox.latMax));
  p.set('leftlon', String(o.bbox.lonMin));
  p.set('rightlon', String(o.bbox.lonMax));
  p.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${p.toString()}`;
}

/** HRRR runs hourly, posts ~50–90 min after the hour; lag 2 h for safety. */
export function pickHrrrRun(atUnixSec: number): { runDateUtc: string; runHourUtc: number } {
  const d = new Date(atUnixSec * 1000 - 2 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: d.getUTCHours() };
}

/** f00–f18 on most runs; f00–f48 on the synoptic 00/06/12/18z runs. */
export function hrrrHorizonHours(runHourUtc: number): number {
  return runHourUtc % 6 === 0 ? 48 : 18;
}

/** Rough CONUS+coastal envelope HRRR actually covers. The eastern edge is
 *  -66° (coast of Maine), not -60°: HRRR's CONUS grid stops well west of
 *  Bermuda (~-64.7°), so a -60° bound would wrongly admit mid-Atlantic boxes
 *  the model never covers. */
export const HRRR_DOMAIN: Bbox = { latMin: 21, latMax: 53, lonMin: -135, lonMax: -66 };

/** Intersect a requested bbox with the HRRR domain. Returns the clipped box, or
 *  null if the request is entirely outside coverage. Lets a ROI that straddles
 *  the coast (e.g. a passage box reaching into the Atlantic) still fetch HRRR
 *  for the covered coastal strip instead of being rejected whole. */
export function clipToHrrrDomain(b: Bbox): Bbox | null {
  const latMin = Math.max(b.latMin, HRRR_DOMAIN.latMin);
  const latMax = Math.min(b.latMax, HRRR_DOMAIN.latMax);
  const lonMin = Math.max(b.lonMin, HRRR_DOMAIN.lonMin);
  const lonMax = Math.min(b.lonMax, HRRR_DOMAIN.lonMax);
  if (latMin >= latMax || lonMin >= lonMax) return null;
  return { latMin, latMax, lonMin, lonMax };
}

/** True when the bbox intersects the HRRR domain at all (gates the model
 *  selector / refresh / "no data" notice). */
export function inHrrrDomain(b: Bbox): boolean {
  return clipToHrrrDomain(b) !== null;
}
