import { greatCircleNm } from './geo';

/** Minimal fix shape shared by the tide/currents station lists. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A station-list entry annotated with its distance from the boat. */
export interface StationDistance<T> {
  item: T;
  /** NM from the fix, or null when no fix / non-finite coordinates. */
  distanceNm: number | null;
}

/**
 * Annotate each item with its great-circle distance (NM) from `fix` and sort
 * closest-first. Graceful degradation: with a null fix the original order is
 * preserved and every distance is null; items with non-finite coordinates
 * sort after all measurable ones (original relative order preserved).
 */
export function sortByDistanceNm<T>(
  items: readonly T[],
  fix: LatLon | null,
  pos: (item: T) => LatLon,
): StationDistance<T>[] {
  const fixOk = fix !== null && Number.isFinite(fix.lat) && Number.isFinite(fix.lon);
  const entries: StationDistance<T>[] = items.map((item) => {
    if (!fixOk) return { item, distanceNm: null };
    const p = pos(item);
    const posOk = Number.isFinite(p.lat) && Number.isFinite(p.lon);
    return { item, distanceNm: posOk ? greatCircleNm(fix, p) : null };
  });
  if (!fixOk) return entries;
  return entries.sort((a, b) => {
    if (a.distanceNm === null && b.distanceNm === null) return 0;
    if (a.distanceNm === null) return 1;
    if (b.distanceNm === null) return -1;
    return a.distanceNm - b.distanceNm;
  });
}

/** Format a station distance as `12.3 NM` (1 decimal), or '' when unknown. */
export function fmtDistanceNm(nm: number | null): string {
  return nm === null ? '' : `${nm.toFixed(1)} NM`;
}
