export interface LatLonLike {
  lat: number;
  lon: number;
}

export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Smallest lat/lon box enclosing all points, padded by `bufferDeg` on each side. */
export function boundingBoxFor(points: LatLonLike[], bufferDeg: number): Bbox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    latMin: Math.min(...lats) - bufferDeg,
    latMax: Math.max(...lats) + bufferDeg,
    lonMin: Math.min(...lons) - bufferDeg,
    lonMax: Math.max(...lons) + bufferDeg,
  };
}
