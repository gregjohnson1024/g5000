export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

// GMRT GridServer only accepts these resolution tiers (`medium` is NOT valid —
// it 404s). `low` is already ≈GEBCO-native (~240 m cells); `high` adds multibeam
// detail where available, for close-in views.
export type BathyResolution = 'low' | 'high';

/** Largest bbox edge (deg) we'll ever request from GMRT, to bound grid size. */
export const MAX_SPAN_DEG = 20;

/**
 * Snap a viewport bbox outward to whole degrees so nearby pans reuse the same
 * cache entry, then clamp each span to MAX_SPAN_DEG about its centre so a
 * zoomed-way-out request can't ask GMRT for a continent-sized grid.
 */
export function snapBbox(b: Bbox): Bbox {
  let latMin = Math.floor(b.latMin);
  let latMax = Math.ceil(b.latMax);
  let lonMin = Math.floor(b.lonMin);
  let lonMax = Math.ceil(b.lonMax);
  if (latMax - latMin > MAX_SPAN_DEG) {
    const c = (latMin + latMax) / 2;
    latMin = Math.floor(c - MAX_SPAN_DEG / 2);
    latMax = latMin + MAX_SPAN_DEG;
  }
  if (lonMax - lonMin > MAX_SPAN_DEG) {
    const c = (lonMin + lonMax) / 2;
    lonMin = Math.floor(c - MAX_SPAN_DEG / 2);
    lonMax = lonMin + MAX_SPAN_DEG;
  }
  return { latMin, latMax, lonMin, lonMax };
}

export function cacheKey(b: Bbox, res: BathyResolution): string {
  return `${b.latMin}_${b.latMax}_${b.lonMin}_${b.lonMax}_${res}`;
}

export function gmrtUrl(b: Bbox, res: BathyResolution): string {
  const u = new URL('https://www.gmrt.org/services/GridServer');
  u.searchParams.set('minlatitude', String(b.latMin));
  u.searchParams.set('maxlatitude', String(b.latMax));
  u.searchParams.set('minlongitude', String(b.lonMin));
  u.searchParams.set('maxlongitude', String(b.lonMax));
  u.searchParams.set('format', 'esriascii');
  u.searchParams.set('resolution', res);
  return u.toString();
}
