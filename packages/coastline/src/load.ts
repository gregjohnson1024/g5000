import { readFile } from 'node:fs/promises';
import RBush from 'rbush';
import type { Coastline, CoastlinePolygon, RBushEntry } from './types.js';
import { ringAabb, type Point } from './geometry.js';

interface GeoJsonFeature {
  type: 'Feature';
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties?: Record<string, unknown>;
}
interface GeoJsonFC {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export async function loadCoastlineFromGeojson(
  path: string,
  level: 'l' | 'i' | 'h',
): Promise<Coastline> {
  const raw = await readFile(path, 'utf8');
  const fc = JSON.parse(raw) as GeoJsonFC;
  const polygons: CoastlinePolygon[] = [];
  for (const f of fc.features) {
    if (f.geometry.type === 'Polygon') {
      polygons.push(toPolygon(f.geometry.coordinates[0] as Point[]));
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        polygons.push(toPolygon(poly[0] as Point[]));
      }
    }
  }
  const index = new RBush<RBushEntry>();
  index.load(
    polygons.map((p) => ({
      minX: p.bbox[0],
      minY: p.bbox[1],
      maxX: p.bbox[2],
      maxY: p.bbox[3],
      polygon: p,
    })),
  );
  return { level, polygons, index };
}

function toPolygon(ring: Point[]): CoastlinePolygon {
  // Ensure closed
  if (
    ring.length === 0 ||
    ring[0]![0] !== ring[ring.length - 1]![0] ||
    ring[0]![1] !== ring[ring.length - 1]![1]
  ) {
    ring = [...ring, ring[0]!];
  }
  return { kind: 'land', ring, bbox: ringAabb(ring) };
}
