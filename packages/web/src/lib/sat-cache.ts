import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Disk cap for the satellite tile cache, tailored to the Pi (29 GB card,
 * 14 GB free). Nothing is auto-deleted — callers pass this to pruneCache. */
export const CAP_BYTES = 8 * 1024 ** 3;
/** Tiles at this zoom or below are never evicted: the cheap, high-value
 * global / regional base. Only z > PROTECT_MAX_ZOOM is a prune candidate. */
export const PROTECT_MAX_ZOOM = 8;

export interface ZoomStat {
  bytes: number;
  tiles: number;
}
export interface CacheStats {
  totalBytes: number;
  tileCount: number;
  capBytes: number;
  byZoom: Record<number, ZoomStat>;
}

interface TileFile {
  path: string;
  z: number;
  bytes: number;
  mtimeMs: number;
}

async function walk(root: string): Promise<TileFile[]> {
  const out: TileFile[] = [];
  let zDirs: string[];
  try {
    zDirs = await readdir(root);
  } catch {
    return out; // missing cache dir → empty
  }
  for (const zName of zDirs) {
    const z = Number(zName);
    if (!Number.isInteger(z)) continue;
    const zPath = join(root, zName);
    let xDirs: string[];
    try {
      xDirs = await readdir(zPath);
    } catch {
      continue;
    }
    for (const xName of xDirs) {
      const xPath = join(zPath, xName);
      let yFiles: string[];
      try {
        yFiles = await readdir(xPath);
      } catch {
        continue;
      }
      for (const yName of yFiles) {
        const p = join(xPath, yName);
        try {
          const s = await stat(p);
          if (!s.isFile()) continue;
          out.push({ path: p, z, bytes: s.size, mtimeMs: s.mtimeMs });
        } catch {
          /* race: file removed between readdir and stat */
        }
      }
    }
  }
  return out;
}

export async function readCacheStats(root: string): Promise<CacheStats> {
  const files = await walk(root);
  const byZoom: Record<number, ZoomStat> = {};
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    const zs = byZoom[f.z] ?? { bytes: 0, tiles: 0 };
    zs.bytes += f.bytes;
    zs.tiles += 1;
    byZoom[f.z] = zs;
  }
  return { totalBytes, tileCount: files.length, capBytes: CAP_BYTES, byZoom };
}

export interface PruneOptions {
  maxBytes?: number;
  olderThanDays?: number;
  /** Override "now" for testing. */
  now?: number;
}
export interface PruneResult {
  removedTiles: number;
  removedBytes: number;
  totalBytesAfter: number;
}

export async function pruneCache(root: string, opts: PruneOptions = {}): Promise<PruneResult> {
  const now = opts.now ?? Date.now();
  const files = await walk(root);
  const totalBefore = files.reduce((a, f) => a + f.bytes, 0);

  // Only tiles above the protected base zoom can be evicted, oldest first.
  const candidates = files
    .filter((f) => f.z > PROTECT_MAX_ZOOM)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const toRemove: TileFile[] = [];
  const removing = new Set<string>();

  // Age-based ("unused"): evict candidates not viewed within olderThanDays.
  if (opts.olderThanDays !== undefined) {
    const cutoff = now - opts.olderThanDays * 24 * 3600 * 1000;
    for (const f of candidates) {
      if (f.mtimeMs < cutoff) {
        toRemove.push(f);
        removing.add(f.path);
      }
    }
  }

  // Budget-based: evict oldest remaining candidates until under maxBytes.
  if (opts.maxBytes !== undefined) {
    let running = totalBefore - toRemove.reduce((a, f) => a + f.bytes, 0);
    for (const f of candidates) {
      if (running <= opts.maxBytes) break;
      if (removing.has(f.path)) continue;
      toRemove.push(f);
      removing.add(f.path);
      running -= f.bytes;
    }
  }

  let removedBytes = 0;
  for (const f of toRemove) {
    try {
      await unlink(f.path);
      removedBytes += f.bytes;
    } catch {
      /* already gone */
    }
  }
  return {
    removedTiles: toRemove.length,
    removedBytes,
    totalBytesAfter: totalBefore - removedBytes,
  };
}
