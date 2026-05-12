import type RBush from 'rbush';

/**
 * One closed-ring polygon in lat/lon degrees. Coordinates are
 * `[lon, lat]` to match GeoJSON convention. First and last point are
 * equal (closed ring). Holes (lakes) are represented as separate polygons
 * marked `kind: 'hole'` for the consumer to subtract during point-in-polygon.
 */
export interface CoastlinePolygon {
  kind: 'land' | 'hole';
  /** [lon, lat] pairs in degrees. */
  ring: Array<[number, number]>;
  /** Precomputed AABB in [lon_min, lat_min, lon_max, lat_max] degrees. */
  bbox: [number, number, number, number];
}

export interface RBushEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  polygon: CoastlinePolygon;
}

export interface Coastline {
  level: 'l' | 'i' | 'h';
  polygons: CoastlinePolygon[];
  /** R-tree indexed by polygon AABB for fast spatial filtering. */
  index: RBush<RBushEntry>;
}
