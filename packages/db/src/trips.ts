import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { trips } from './schema.js';

/** How the trip was propelled. Heuristic at insert time; user-overridable. */
export type TripMode = 'sail' | 'motor' | 'mixed' | 'unknown';

/** Classification of the stay BEGUN at trip end. */
export type TripStayKind = 'anchor' | 'unknown';

export interface Trip {
  id: number;
  boatId: string;
  /** Epoch ms, backdated to when the boat actually started moving. */
  startMs: number;
  /** Epoch ms, backdated to when the boat actually stopped. */
  endMs: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  avgSogKn: number;
  mode: TripMode;
  /** Seconds per point-of-sail state (e.g. { upwind: 1200 }), or null. */
  pointOfSail: Record<string, number> | null;
  stayKind: TripStayKind;
  moorageStartName: string | null;
  moorageEndName: string | null;
  notes: string | null;
  createdMs: number;
}

export interface InsertTripArgs {
  boatId: string;
  startMs: number;
  endMs: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  avgSogKn: number;
  mode: TripMode;
  pointOfSail?: Record<string, number> | null;
  stayKind: TripStayKind;
  moorageStartName?: string | null;
  moorageEndName?: string | null;
  notes?: string | null;
  /** Defaults to Date.now(). */
  createdMs?: number;
}

export interface ListTripsArgs {
  boatId: string;
  limit: number;
  /** Return only rows with startMs < this cursor (for pagination). */
  beforeMs?: number;
  /** Return only rows with startMs >= fromMs. */
  fromMs?: number;
  /** Return only rows with startMs <= toMs. */
  toMs?: number;
}

/** User-editable fields; everything else is measurement, not opinion. */
export interface UpdateTripPatch {
  mode?: TripMode;
  moorageStartName?: string | null;
  moorageEndName?: string | null;
  notes?: string | null;
}

export async function insertTrip(store: ConfigStore, args: InsertTripArgs): Promise<number> {
  const db = store.drizzle;
  const result = await db
    .insert(trips)
    .values({
      boatId: args.boatId,
      startMs: args.startMs,
      endMs: args.endMs,
      startLat: args.startLat,
      startLon: args.startLon,
      endLat: args.endLat,
      endLon: args.endLon,
      distanceM: args.distanceM,
      durationS: args.durationS,
      maxSogKn: args.maxSogKn,
      avgSogKn: args.avgSogKn,
      mode: args.mode,
      pointOfSailJson: args.pointOfSail ? JSON.stringify(args.pointOfSail) : null,
      stayKind: args.stayKind,
      moorageStartName: args.moorageStartName ?? null,
      moorageEndName: args.moorageEndName ?? null,
      notes: args.notes ?? null,
      createdMs: args.createdMs ?? Date.now(),
    })
    .returning({ id: trips.id })
    .get();
  return result.id;
}

export async function listTrips(store: ConfigStore, args: ListTripsArgs): Promise<Trip[]> {
  const db = store.drizzle;
  const conds = [eq(trips.boatId, args.boatId)];
  if (args.beforeMs !== undefined) conds.push(lt(trips.startMs, args.beforeMs));
  if (args.fromMs !== undefined) conds.push(gte(trips.startMs, args.fromMs));
  if (args.toMs !== undefined) conds.push(lte(trips.startMs, args.toMs));
  const rows = await db
    .select()
    .from(trips)
    .where(and(...conds))
    .orderBy(desc(trips.startMs))
    .limit(args.limit)
    .all();
  return rows.map(rowToTrip);
}

export async function getTrip(
  store: ConfigStore,
  id: number,
  boatId: string,
): Promise<Trip | null> {
  const db = store.drizzle;
  const row = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.boatId, boatId)))
    .get();
  return row ? rowToTrip(row) : null;
}

export async function updateTrip(
  store: ConfigStore,
  id: number,
  boatId: string,
  patch: UpdateTripPatch,
): Promise<boolean> {
  const set: Partial<typeof trips.$inferInsert> = {};
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.moorageStartName !== undefined) set.moorageStartName = patch.moorageStartName;
  if (patch.moorageEndName !== undefined) set.moorageEndName = patch.moorageEndName;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (Object.keys(set).length === 0) {
    return (await getTrip(store, id, boatId)) !== null;
  }
  const db = store.drizzle;
  const res = await db
    .update(trips)
    .set(set)
    .where(and(eq(trips.id, id), eq(trips.boatId, boatId)))
    .returning({ id: trips.id })
    .get();
  return res !== undefined;
}

export async function deleteTrip(store: ConfigStore, id: number, boatId: string): Promise<boolean> {
  const db = store.drizzle;
  const res = await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.boatId, boatId)))
    .returning({ id: trips.id })
    .get();
  return res !== undefined;
}

interface RawRow {
  id: number;
  boatId: string;
  startMs: number;
  endMs: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  avgSogKn: number;
  mode: string;
  pointOfSailJson: string | null;
  stayKind: string;
  moorageStartName: string | null;
  moorageEndName: string | null;
  notes: string | null;
  createdMs: number;
}

function rowToTrip(r: RawRow): Trip {
  let pointOfSail: Record<string, number> | null = null;
  if (r.pointOfSailJson) {
    try {
      pointOfSail = JSON.parse(r.pointOfSailJson) as Record<string, number>;
    } catch {
      pointOfSail = null;
    }
  }
  return {
    id: r.id,
    boatId: r.boatId,
    startMs: r.startMs,
    endMs: r.endMs,
    startLat: r.startLat,
    startLon: r.startLon,
    endLat: r.endLat,
    endLon: r.endLon,
    distanceM: r.distanceM,
    durationS: r.durationS,
    maxSogKn: r.maxSogKn,
    avgSogKn: r.avgSogKn,
    mode: r.mode as TripMode,
    pointOfSail,
    stayKind: r.stayKind as TripStayKind,
    moorageStartName: r.moorageStartName,
    moorageEndName: r.moorageEndName,
    notes: r.notes,
    createdMs: r.createdMs,
  };
}
