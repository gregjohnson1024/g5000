import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DepthField } from '@g5000/routing';
import { ROOT } from './paths';
import type { Bbox } from './route-bbox';

/**
 * Tiny binary depth-grid store under ~/.g5000-router/depth-grid/ — the
 * server-side data behind the router's draft constraint.
 *
 * Layout: `manifest.json` describing every tile, plus one `<name>.bin` per
 * tile — a row-major little-endian Int16 grid of depths in metres (positive
 * down), NODATA (-32768) for land / missing. Row 0 is the SOUTH edge
 * (latMin), column 0 the WEST edge (lonMin); sample (r, c) sits at
 * (latMin + r·dLat, lonMin + c·dLon). Tiles are written by
 * scripts/depth-grid-fetch.ts on shore wifi and read lazily here.
 */

export const NODATA = -32768;
export const DEPTH_GRID_DIR = join(ROOT, 'depth-grid');

export interface DepthTileMeta {
  name: string;
  latMin: number;
  lonMin: number;
  dLat: number;
  dLon: number;
  rows: number;
  cols: number;
}

export interface DepthGridManifest {
  resArcSec: number;
  tiles: DepthTileMeta[];
}

const tileLatMax = (t: DepthTileMeta): number => t.latMin + (t.rows - 1) * t.dLat;
const tileLonMax = (t: DepthTileMeta): number => t.lonMin + (t.cols - 1) * t.dLon;

function overlapsBbox(t: DepthTileMeta, b: Bbox): boolean {
  return (
    t.latMin <= b.latMax &&
    tileLatMax(t) >= b.latMin &&
    t.lonMin <= b.lonMax &&
    tileLonMax(t) >= b.lonMin
  );
}

/**
 * Write (or merge) tiles into a depth-grid directory. Existing manifest tiles
 * with the same name are replaced; others are kept, so successive fetches of
 * different bboxes accumulate coverage.
 */
export async function writeDepthGrid(
  dir: string,
  resArcSec: number,
  tiles: Array<{ meta: DepthTileMeta; data: Int16Array }>,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  let manifest: DepthGridManifest = { resArcSec, tiles: [] };
  try {
    const existing = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8')) as
      | DepthGridManifest
      | undefined;
    if (existing && Array.isArray(existing.tiles)) manifest = { ...existing, resArcSec };
  } catch {
    /* no manifest yet — start fresh */
  }
  for (const { meta, data } of tiles) {
    if (data.length !== meta.rows * meta.cols) {
      throw new Error(`tile ${meta.name}: data length ${data.length} != rows*cols`);
    }
    // Explicit little-endian regardless of platform.
    const buf = Buffer.alloc(data.length * 2);
    for (let i = 0; i < data.length; i++) buf.writeInt16LE(data[i]!, i * 2);
    await fs.writeFile(join(dir, `${meta.name}.bin`), buf);
    manifest.tiles = [...manifest.tiles.filter((t) => t.name !== meta.name), meta];
  }
  await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

/**
 * Load a DepthField covering `bbox`, or null when no tiles overlap it (no
 * manifest at all counts as no coverage). Tile binaries are fs-read lazily
 * on the first sample that lands in them; a missing/corrupt .bin degrades to
 * "unknown depth" (null samples) rather than throwing inside the planner.
 */
export async function loadDepthField(bbox: Bbox, dir = DEPTH_GRID_DIR): Promise<DepthField | null> {
  let manifest: DepthGridManifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as DepthGridManifest;
  } catch {
    return null;
  }
  if (!Array.isArray(manifest.tiles)) return null;
  const covering = manifest.tiles.filter((t) => overlapsBbox(t, bbox));
  if (covering.length === 0) return null;

  // Lazy per-tile buffer cache; null = read failed (treat as no data).
  const buffers = new Map<string, DataView | null>();
  const bufFor = (t: DepthTileMeta): DataView | null => {
    let dv = buffers.get(t.name);
    if (dv === undefined) {
      try {
        const raw = readFileSync(join(dir, `${t.name}.bin`));
        dv =
          raw.byteLength === t.rows * t.cols * 2
            ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
            : null;
      } catch {
        dv = null;
      }
      buffers.set(t.name, dv);
    }
    return dv;
  };
  const at = (dv: DataView, t: DepthTileMeta, r: number, c: number): number =>
    dv.getInt16((r * t.cols + c) * 2, true);

  return {
    depthAt(lat: number, lon: number): number | null {
      for (const t of covering) {
        if (lat < t.latMin || lat > tileLatMax(t) || lon < t.lonMin || lon > tileLonMax(t))
          continue;
        const dv = bufFor(t);
        if (!dv) continue;
        // Bilinear over the four surrounding samples. A NODATA corner that
        // actually carries weight makes the answer unknown — don't
        // interpolate across land/missing cells — but zero-weight corners
        // (exact node/edge hits) don't gate the result.
        const fr = (lat - t.latMin) / t.dLat;
        const fc = (lon - t.lonMin) / t.dLon;
        const r0 = Math.max(0, Math.min(Math.floor(fr), t.rows - 2));
        const c0 = Math.max(0, Math.min(Math.floor(fc), t.cols - 2));
        const r1 = Math.min(r0 + 1, t.rows - 1);
        const c1 = Math.min(c0 + 1, t.cols - 1);
        const wr = Math.max(0, Math.min(1, fr - r0));
        const wc = Math.max(0, Math.min(1, fc - c0));
        const corners: Array<[number, number, number]> = [
          [r0, c0, (1 - wr) * (1 - wc)],
          [r0, c1, (1 - wr) * wc],
          [r1, c0, wr * (1 - wc)],
          [r1, c1, wr * wc],
        ];
        let sum = 0;
        for (const [r, c, w] of corners) {
          if (w === 0) continue;
          const v = at(dv, t, r, c);
          if (v === NODATA) return null;
          sum += v * w;
        }
        return sum;
      }
      return null;
    },
  };
}
