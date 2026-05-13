import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { WAYPOINTS } from './paths';

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Optional free-form notes. */
  notes?: string;
  /** Set on create, ISO 8601. */
  createdAt: string;
}

const BRISTOL_MARINE: Waypoint = {
  id: 'bristol-marine',
  name: 'Bristol Marine',
  // 41°45'53.9"N 71°07'42.6"W → decimal
  lat: 41 + 45 / 60 + 53.9 / 3600,
  lon: -(71 + 7 / 60 + 42.6 / 3600),
  notes: 'Bristol RI — destination for the Bermuda → Newport passage (2026)',
  createdAt: '2026-05-13T20:00:00.000Z',
};

async function readWaypoints(): Promise<Waypoint[]> {
  try {
    const buf = await fs.readFile(WAYPOINTS, 'utf8');
    const parsed = JSON.parse(buf) as unknown;
    if (!Array.isArray(parsed)) return [BRISTOL_MARINE];
    const cleaned = parsed.filter(isWaypoint) as Waypoint[];
    return cleaned;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // First run: seed Bristol Marine so the chart has at least one
      // destination to plan against without the user typing it in.
      await writeWaypoints([BRISTOL_MARINE]);
      return [BRISTOL_MARINE];
    }
    throw err;
  }
}

async function writeWaypoints(wps: Waypoint[]): Promise<void> {
  await fs.mkdir(dirname(WAYPOINTS), { recursive: true });
  await fs.writeFile(WAYPOINTS, JSON.stringify(wps, null, 2), 'utf8');
}

function isWaypoint(v: unknown): v is Waypoint {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lon === 'number' &&
    typeof o.createdAt === 'string'
  );
}

export async function listWaypoints(): Promise<Waypoint[]> {
  return readWaypoints();
}

export async function getWaypoint(id: string): Promise<Waypoint | null> {
  const list = await readWaypoints();
  return list.find((w) => w.id === id) ?? null;
}

export async function createWaypoint(
  input: Omit<Waypoint, 'id' | 'createdAt'> & { id?: string },
): Promise<Waypoint> {
  const list = await readWaypoints();
  const id =
    input.id?.trim() ||
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    `wp-${Date.now()}`;
  if (list.some((w) => w.id === id)) {
    throw new Error(`waypoint id "${id}" already exists`);
  }
  const next: Waypoint = {
    id,
    name: input.name,
    lat: input.lat,
    lon: input.lon,
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };
  list.push(next);
  await writeWaypoints(list);
  return next;
}

export async function updateWaypoint(
  id: string,
  patch: Partial<Omit<Waypoint, 'id' | 'createdAt'>>,
): Promise<Waypoint | null> {
  const list = await readWaypoints();
  const idx = list.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  const merged: Waypoint = { ...list[idx]!, ...patch, id, createdAt: list[idx]!.createdAt };
  list[idx] = merged;
  await writeWaypoints(list);
  return merged;
}

export async function deleteWaypoint(id: string): Promise<boolean> {
  const list = await readWaypoints();
  const idx = list.findIndex((w) => w.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  await writeWaypoints(list);
  return true;
}
