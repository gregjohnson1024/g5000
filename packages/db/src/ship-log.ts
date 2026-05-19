import { and, desc, eq, gte, lt, like, or } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { shipLogEntries } from './schema.js';

export type ShipLogSource = 'manual' | 'auto';

export type ShipLogKind = 'note' | 'position' | 'weather' | 'equipment' | 'incident' | 'crew';

export interface ShipLogEntry {
  id: number;
  tsMs: number;
  source: ShipLogSource;
  kind: ShipLogKind;
  text: string | null;
  lat: number | null;
  lon: number | null;
  cogDeg: number | null;
  sogKn: number | null;
  hdgDeg: number | null;
  twsKn: number | null;
  twdDeg: number | null;
  author: string | null;
  boatId: string;
}

export interface InsertShipLogEntryArgs {
  tsMs: number;
  source: ShipLogSource;
  kind: ShipLogKind;
  text?: string | null;
  lat?: number | null;
  lon?: number | null;
  cogDeg?: number | null;
  sogKn?: number | null;
  hdgDeg?: number | null;
  twsKn?: number | null;
  twdDeg?: number | null;
  author?: string | null;
  boatId: string;
}

export interface ListShipLogEntriesArgs {
  boatId: string;
  limit: number;
  /** Return only rows with tsMs < this cursor (for pagination). */
  beforeMs?: number;
  /** Filter by source. */
  source?: ShipLogSource;
  /** Filter by kind (exact match). */
  kind?: ShipLogKind;
  /** Substring search across `text` and `author`. */
  q?: string;
}

export async function insertShipLogEntry(
  store: ConfigStore,
  args: InsertShipLogEntryArgs,
): Promise<number> {
  const db = store.drizzle;
  const result = await db
    .insert(shipLogEntries)
    .values({
      tsMs: args.tsMs,
      source: args.source,
      kind: args.kind,
      text: args.text ?? null,
      lat: args.lat ?? null,
      lon: args.lon ?? null,
      cogDeg: args.cogDeg ?? null,
      sogKn: args.sogKn ?? null,
      hdgDeg: args.hdgDeg ?? null,
      twsKn: args.twsKn ?? null,
      twdDeg: args.twdDeg ?? null,
      author: args.author ?? null,
      boatId: args.boatId,
    })
    .returning({ id: shipLogEntries.id })
    .get();
  return result.id;
}

export async function listShipLogEntries(
  store: ConfigStore,
  args: ListShipLogEntriesArgs,
): Promise<ShipLogEntry[]> {
  const db = store.drizzle;
  const conds = [eq(shipLogEntries.boatId, args.boatId)];
  if (args.beforeMs !== undefined) conds.push(lt(shipLogEntries.tsMs, args.beforeMs));
  if (args.source) conds.push(eq(shipLogEntries.source, args.source));
  if (args.kind) conds.push(eq(shipLogEntries.kind, args.kind));
  if (args.q && args.q.trim().length > 0) {
    const pat = `%${args.q.trim()}%`;
    const searchCond = or(like(shipLogEntries.text, pat), like(shipLogEntries.author, pat));
    if (searchCond) conds.push(searchCond);
  }
  const rows = await db
    .select()
    .from(shipLogEntries)
    .where(and(...conds))
    .orderBy(desc(shipLogEntries.tsMs))
    .limit(args.limit)
    .all();
  return rows.map(rowToEntry);
}

export async function deleteShipLogEntry(
  store: ConfigStore,
  id: number,
  boatId: string,
): Promise<boolean> {
  const db = store.drizzle;
  const res = await db
    .delete(shipLogEntries)
    .where(and(eq(shipLogEntries.id, id), eq(shipLogEntries.boatId, boatId)))
    .returning({ id: shipLogEntries.id })
    .get();
  return res !== undefined;
}

/**
 * Most-recent `tsMs` for an auto entry. Used by the hourly auto-logger to
 * decide whether to write a new row. Returns null if the table has never
 * had an auto row for this boat.
 */
export async function lastAutoEntryTsMs(
  store: ConfigStore,
  boatId: string,
): Promise<number | null> {
  const db = store.drizzle;
  const row = await db
    .select({ tsMs: shipLogEntries.tsMs })
    .from(shipLogEntries)
    .where(and(eq(shipLogEntries.boatId, boatId), eq(shipLogEntries.source, 'auto')))
    .orderBy(desc(shipLogEntries.tsMs))
    .limit(1)
    .get();
  return row?.tsMs ?? null;
}

interface RawRow {
  id: number;
  tsMs: number;
  source: string;
  kind: string;
  text: string | null;
  lat: number | null;
  lon: number | null;
  cogDeg: number | null;
  sogKn: number | null;
  hdgDeg: number | null;
  twsKn: number | null;
  twdDeg: number | null;
  author: string | null;
  boatId: string;
}

function rowToEntry(r: RawRow): ShipLogEntry {
  return {
    id: r.id,
    tsMs: r.tsMs,
    source: r.source as ShipLogSource,
    kind: r.kind as ShipLogKind,
    text: r.text,
    lat: r.lat,
    lon: r.lon,
    cogDeg: r.cogDeg,
    sogKn: r.sogKn,
    hdgDeg: r.hdgDeg,
    twsKn: r.twsKn,
    twdDeg: r.twdDeg,
    author: r.author,
    boatId: r.boatId,
  };
}
