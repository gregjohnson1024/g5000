import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths';
import type { TrackAnnotation } from './track-annotations';
export { openPeriodStart, type TrackAnnotation } from './track-annotations';

/**
 * Track storage.
 *
 * Each track is a JSON file at `~/.g5000-router/tracks/track-NNN.json`. A
 * track is "active" when its `endedAt === null`; only the most recent track
 * can be active at any time (enforced by `interruptActive`).
 *
 * Append-only by intent: appending a point appends to the array and writes
 * the file back. For long-lived recordings this is fine because we
 * down-sample at the recorder layer (one point per 30 s or 100 m), so even
 * a multi-day passage stays under a few thousand points and a few hundred
 * KB on disk.
 */
export const TRACKS_DIR = join(ROOT, 'tracks');

export interface TrackPoint {
  /** Unix seconds (float OK). */
  t: number;
  lat: number;
  lon: number;
  /** Course over ground, radians (0–2π). */
  cog?: number;
  /** Speed over ground, m/s. */
  sog?: number;
  /** Heading (true reference), radians (0–2π). */
  hdg?: number;
}

export interface TrackMeta {
  id: string;
  /** Monotonic integer; never reused even after deletion. */
  number: number;
  /** Human label (free text). */
  label: string;
  /** ISO 8601 UTC. */
  startedAt: string;
  /** ISO 8601 UTC. `null` if the track is still being recorded. */
  endedAt: string | null;
  pointCount: number;
  totalDistanceM: number;
}

export interface Track extends TrackMeta {
  points: TrackPoint[];
  /** Hand-dropped markers in chronological order. Absent on older files;
   * `getTrack` always normalises to []. */
  annotations?: TrackAnnotation[];
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(TRACKS_DIR, { recursive: true });
}

function trackPath(id: string): string {
  return join(TRACKS_DIR, `${id}.json`);
}

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function summarise(t: Track): TrackMeta {
  let dist = 0;
  for (let i = 1; i < t.points.length; i++) {
    dist += haversineM(t.points[i - 1]!, t.points[i]!);
  }
  return {
    id: t.id,
    number: t.number,
    label: t.label,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    pointCount: t.points.length,
    totalDistanceM: dist,
  };
}

/** List metadata for every track on disk, sorted by track number ascending. */
export async function listTracks(): Promise<TrackMeta[]> {
  await ensureDir();
  const files = await fs.readdir(TRACKS_DIR);
  const out: TrackMeta[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(join(TRACKS_DIR, f), 'utf8');
      const t = JSON.parse(raw) as Track;
      out.push(summarise(t));
    } catch {
      /* corrupt — skip */
    }
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

export async function getTrack(id: string): Promise<Track | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(trackPath(id), 'utf8');
    const t = JSON.parse(raw) as Track;
    const meta = summarise(t);
    return { ...t, pointCount: meta.pointCount, totalDistanceM: meta.totalDistanceM };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeTrack(t: Track): Promise<void> {
  await ensureDir();
  // Always recompute summary fields before writing so on-disk values are
  // self-consistent (handy for inspecting raw JSON).
  const meta = summarise(t);
  const out: Track = { ...t, pointCount: meta.pointCount, totalDistanceM: meta.totalDistanceM };
  // Atomic write: write to a temp file then rename. Avoids torn JSON if the
  // process is killed mid-write.
  const tmp = trackPath(t.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(out));
  await fs.rename(tmp, trackPath(t.id));
}

/** The currently-active track (endedAt === null), or null if none exists. */
export async function activeTrack(): Promise<Track | null> {
  const metas = await listTracks();
  // Walk from highest number down; the most recent active wins.
  for (let i = metas.length - 1; i >= 0; i--) {
    const m = metas[i]!;
    if (m.endedAt === null) return getTrack(m.id);
  }
  return null;
}

export async function createTrack(label = ''): Promise<Track> {
  const metas = await listTracks();
  const next = metas.length === 0 ? 1 : Math.max(...metas.map((m) => m.number)) + 1;
  const id = `track-${String(next).padStart(3, '0')}`;
  const t: Track = {
    id,
    number: next,
    label,
    startedAt: new Date().toISOString(),
    endedAt: null,
    points: [],
    pointCount: 0,
    totalDistanceM: 0,
  };
  await writeTrack(t);
  return t;
}

/** Close the currently-active track and start a fresh one. Returns the new track. */
export async function interruptActive(label = ''): Promise<Track> {
  const cur = await activeTrack();
  if (cur) {
    cur.endedAt = new Date().toISOString();
    await writeTrack(cur);
  }
  return createTrack(label);
}

export async function appendPoint(id: string, pt: TrackPoint): Promise<Track | null> {
  const t = await getTrack(id);
  if (!t) return null;
  if (t.endedAt !== null) {
    throw new Error(`track ${id} is ended; cannot append`);
  }
  t.points.push(pt);
  await writeTrack(t);
  return t;
}

/**
 * Append a TrackAnnotation to the active track at `id`. The annotation's
 * `tsMs` should be set by the caller (the API route uses `Date.now()`).
 * Returns the updated track, or null if the id doesn't exist. Throws if
 * the track is already ended.
 */
export async function appendAnnotation(id: string, ann: TrackAnnotation): Promise<Track | null> {
  const t = await getTrack(id);
  if (!t) return null;
  if (t.endedAt !== null) {
    throw new Error(`track ${id} is ended; cannot append annotation`);
  }
  const next: Track = {
    ...t,
    annotations: [...(t.annotations ?? []), ann],
  };
  await writeTrack(next);
  return next;
}

export async function updateTrack(
  id: string,
  patch: Partial<Pick<Track, 'label' | 'endedAt'>>,
): Promise<Track | null> {
  const t = await getTrack(id);
  if (!t) return null;
  if (typeof patch.label === 'string') t.label = patch.label;
  if (patch.endedAt !== undefined) t.endedAt = patch.endedAt;
  await writeTrack(t);
  return t;
}

export async function deleteTrack(id: string): Promise<boolean> {
  try {
    await fs.unlink(trackPath(id));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
