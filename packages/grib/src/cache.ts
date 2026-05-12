import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Bbox } from './types.js';

export type CacheModel = 'gfs' | 'ecmwf' | 'rtofs';
export type CacheVariable = 'u10' | 'v10' | 'mslp' | 'uogrd' | 'vogrd';

export interface CacheKey {
  model: CacheModel;
  runTime: number;
  bbox: Bbox;
  variable: CacheVariable;
}

export function bboxHash(b: Bbox): string {
  return createHash('sha256')
    .update(`${b.latMin}|${b.latMax}|${b.lonMin}|${b.lonMax}`)
    .digest('hex')
    .slice(0, 12);
}

export function cachePath(root: string, k: CacheKey): string {
  return join(root, k.model, String(k.runTime), bboxHash(k.bbox), `${k.variable}.grb2`);
}

export function cacheHas(root: string, k: CacheKey): boolean {
  return existsSync(cachePath(root, k));
}

export async function cacheStore(root: string, k: CacheKey, buf: Buffer): Promise<void> {
  const p = cachePath(root, k);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
}

export async function cacheRead(root: string, k: CacheKey): Promise<Buffer> {
  return readFile(cachePath(root, k));
}

export async function cacheAge(root: string, k: CacheKey): Promise<number | undefined> {
  const p = cachePath(root, k);
  if (!existsSync(p)) return undefined;
  const s = await stat(p);
  return Date.now() - s.mtimeMs;
}
