/**
 * Pure bbox math for the chart's draggable forecast ROI. Kept separate
 * from ForecastRoi.tsx so it can be unit-tested without bringing maplibre
 * + React into the test harness.
 */

export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export type Corner = 'sw' | 'se' | 'ne' | 'nw';
export const CORNERS: Corner[] = ['sw', 'se', 'ne', 'nw'];

/**
 * Each corner owns one lat-extreme × one lon-extreme. Writing to the
 * extremes the corner OWNS — not min/max across all 4 corners — is what
 * lets the user drag a corner *inward* (shrink the box). A naive
 * reduce-all approach kept the other 3 corners' extremes in play and
 * silently snapped the dragged corner back. After writing, we normalise
 * so a cross-the-opposite-corner drag flips cleanly to a valid bbox.
 */
export function updateCorner(b: Bbox, c: Corner, lngLat: { lat: number; lng: number }): Bbox {
  let { latMin, latMax, lonMin, lonMax } = b;
  switch (c) {
    case 'sw':
      latMin = lngLat.lat;
      lonMin = lngLat.lng;
      break;
    case 'se':
      latMin = lngLat.lat;
      lonMax = lngLat.lng;
      break;
    case 'ne':
      latMax = lngLat.lat;
      lonMax = lngLat.lng;
      break;
    case 'nw':
      latMax = lngLat.lat;
      lonMin = lngLat.lng;
      break;
  }
  return {
    latMin: Math.min(latMin, latMax),
    latMax: Math.max(latMin, latMax),
    lonMin: Math.min(lonMin, lonMax),
    lonMax: Math.max(lonMin, lonMax),
  };
}

export function cornersFromBbox(b: Bbox): Record<Corner, [number, number]> {
  return {
    sw: [b.lonMin, b.latMin],
    se: [b.lonMax, b.latMin],
    ne: [b.lonMax, b.latMax],
    nw: [b.lonMin, b.latMax],
  };
}

export function polygonFromBbox(b: Bbox): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [b.lonMin, b.latMin],
          [b.lonMax, b.latMin],
          [b.lonMax, b.latMax],
          [b.lonMin, b.latMax],
          [b.lonMin, b.latMin],
        ],
      ],
    },
  };
}

/** Sub-arc-second tolerance for "did the user actually drag?" comparison. */
const BBOX_EPS = 1e-9;

export function bboxesEqual(a: Bbox, b: Bbox): boolean {
  return (
    Math.abs(a.latMin - b.latMin) < BBOX_EPS &&
    Math.abs(a.latMax - b.latMax) < BBOX_EPS &&
    Math.abs(a.lonMin - b.lonMin) < BBOX_EPS &&
    Math.abs(a.lonMax - b.lonMax) < BBOX_EPS
  );
}
