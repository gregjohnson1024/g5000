import { getSharedConfigStore, type Route } from '@g5000/db';

export type { Route };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function read(): Promise<Route[]> {
  return getSharedConfigStore().getRoutes();
}
async function write(list: Route[]): Promise<void> {
  await getSharedConfigStore().setRoutes(list);
}

function assertWaypointsExist(waypointIds: string[]): void {
  const known = new Set(
    getSharedConfigStore()
      .getWaypoints()
      .map((w) => w.id),
  );
  const unknown = waypointIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`unknown waypoint id(s): ${unknown.join(', ')}`);
  }
}

export async function listRoutes(): Promise<Route[]> {
  return read();
}

export async function getRoute(id: string): Promise<Route | null> {
  return (await read()).find((r) => r.id === id) ?? null;
}

export async function createRoute(input: {
  name: string;
  waypointIds: string[];
  notes?: string;
  id?: string;
}): Promise<Route> {
  assertWaypointsExist(input.waypointIds);
  const list = await read();
  const id = input.id?.trim() || slugify(input.name);
  if (!id) throw new Error('route id could not be derived from name');
  if (list.some((r) => r.id === id)) throw new Error(`route id already exists: ${id}`);
  const now = new Date().toISOString();
  const route: Route = {
    id,
    name: input.name,
    waypointIds: input.waypointIds,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await write([...list, route]);
  return route;
}

export async function updateRoute(
  id: string,
  patch: Partial<Pick<Route, 'name' | 'waypointIds' | 'notes'>>,
): Promise<Route | null> {
  if (patch.waypointIds) assertWaypointsExist(patch.waypointIds);
  const list = await read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const updated: Route = { ...list[idx]!, ...patch, updatedAt: new Date().toISOString() };
  list[idx] = updated;
  await write(list);
  return updated;
}

export async function deleteRoute(id: string): Promise<boolean> {
  const list = await read();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  await write(next);
  return true;
}

/** Routes that reference the given waypoint id (for the delete guard). */
export async function routesUsingWaypoint(waypointId: string): Promise<Route[]> {
  return (await read()).filter((r) => r.waypointIds.includes(waypointId));
}
