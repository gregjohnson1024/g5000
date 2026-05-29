import { getSharedConfigStore, type Waypoint } from '@g5000/db';
import { slugify } from './slug';

export type { Waypoint };

const NANTUCKET: Waypoint = {
  id: 'nantucket',
  name: 'Nantucket',
  // 41°17.4'N 70°05.4'W. Nantucket Harbor entrance (Brant Point
  // Light area). Was the active destination earlier in the Bermuda
  // passage; kept as a waypoint since it's a real anchor point.
  lat: 41.29,
  lon: -70.09,
  notes: 'Nantucket Harbor (Brant Point), Nantucket MA',
  createdAt: '2026-05-16T00:00:00.000Z',
};

const NEWPORT: Waypoint = {
  id: 'newport',
  name: 'Newport',
  // 41°29.2'N 71°19.5'W. Newport Shipyard, RI — the final
  // destination of the Bermuda passage as of 2026-05-17.
  lat: 41.4869,
  lon: -71.3258,
  notes: 'Newport Shipyard, RI — destination for the Bermuda → Newport passage (2026)',
  createdAt: '2026-05-17T00:00:00.000Z',
};

const BLOCK_ISLAND: Waypoint = {
  id: 'block-island',
  name: 'Block Island',
  // 41°10.9'N 71°34.0'W. Champlin's Marina, Great Salt Pond — the
  // planned fuel-stop option on the way to Newport.
  lat: 41.1817,
  lon: -71.5667,
  notes: "Champlin's Marina, Great Salt Pond — fuel-stop option on the Bermuda → Newport passage",
  createdAt: '2026-05-17T00:00:00.000Z',
};

const MOORE_BROS: Waypoint = {
  id: 'moore-bros',
  name: 'Moore Bros',
  // 41°42.237'N 71°16.226'W — user-supplied fix for Moore Brothers
  // Co., 115 Broadcommon Rd, Bristol RI. Sits up the bay on the
  // Mt Hope Bay side, north of Bristol Harbor.
  lat: 41.70395,
  lon: -71.27043,
  notes: 'Moore Brothers Co., 115 Broadcommon Rd, Bristol RI 02809',
  createdAt: '2026-05-17T00:00:00.000Z',
};

/**
 * Canonical seeded waypoints. On every read we ensure any seed whose
 * `id` is missing from the persisted store gets added back — so a fresh
 * install or a deployed Pi without these IDs picks them up automatically,
 * but a user-edited copy of "newport" (different coords/notes) is left
 * alone because the id collision is checked, not the content. Re-adding
 * a seed waypoint after manual deletion is the documented trade-off.
 */
const SEEDS: Waypoint[] = [NANTUCKET, NEWPORT, BLOCK_ISLAND, MOORE_BROS];
export const SEED_WAYPOINT_IDS = SEEDS.map((w) => w.id);

/** Read the store, union any missing seeds, persist if changed. */
async function readWaypoints(): Promise<Waypoint[]> {
  const store = getSharedConfigStore();
  const current = store.getWaypoints();
  const byId = new Map(current.map((w) => [w.id, w]));
  let changed = false;
  for (const seed of SEEDS) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      changed = true;
    }
  }
  const list = [...byId.values()];
  if (changed) await store.setWaypoints(list);
  return list;
}

async function writeWaypoints(list: Waypoint[]): Promise<void> {
  await getSharedConfigStore().setWaypoints(list);
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
  const id = input.id?.trim() || slugify(input.name) || `wp-${Date.now()}`;
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
