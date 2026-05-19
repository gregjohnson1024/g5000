import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BoatId, PolarMode, PolarRevision, PolarTable } from './defaults.js';
import { polarRevisions } from './schema.js';

/**
 * Throws if `table` violates structural invariants. Pure; no I/O.
 *
 * Invariants:
 *  - `twsBins` and `twaBins` are non-empty and strictly increasing.
 *  - `twaBins` lie within [0, π] inclusive.
 *  - `boatSpeed` has shape `[twsBins.length][twaBins.length]`, all finite, non-negative.
 *  - If `heel` or `leeway` is present, it has the same shape as `boatSpeed` and all finite.
 */
export function validatePolarTable(table: PolarTable): void {
  const { twsBins, twaBins, boatSpeed, heel, leeway } = table;
  if (!Array.isArray(twsBins) || twsBins.length === 0) throw new Error('twsBins is empty');
  if (!Array.isArray(twaBins) || twaBins.length === 0) throw new Error('twaBins is empty');
  for (let i = 1; i < twsBins.length; i++) {
    if (!(twsBins[i]! > twsBins[i - 1]!)) throw new Error('twsBins not strictly monotonic');
  }
  for (let i = 1; i < twaBins.length; i++) {
    if (!(twaBins[i]! > twaBins[i - 1]!)) throw new Error('twaBins not strictly monotonic');
  }
  for (const t of twaBins) {
    if (!(t >= 0 && t <= Math.PI)) throw new Error('twaBins outside [0, π]');
  }
  if (!Array.isArray(boatSpeed) || boatSpeed.length !== twsBins.length) {
    throw new Error('boatSpeed outer dimension mismatch');
  }
  for (let i = 0; i < twsBins.length; i++) {
    const row = boatSpeed[i];
    if (!Array.isArray(row) || row.length !== twaBins.length) {
      throw new Error('boatSpeed inner dimension mismatch');
    }
    for (const v of row) {
      if (!Number.isFinite(v)) throw new Error('boatSpeed cell not finite');
      if (v < 0) throw new Error('boatSpeed cell must be non-negative');
    }
  }
  for (const [name, grid] of [
    ['heel', heel],
    ['leeway', leeway],
  ] as const) {
    if (grid === undefined) continue;
    if (!Array.isArray(grid) || grid.length !== twsBins.length) {
      throw new Error(`${name} grid outer dimension mismatch`);
    }
    for (let i = 0; i < twsBins.length; i++) {
      const row = grid[i];
      if (!Array.isArray(row) || row.length !== twaBins.length) {
        throw new Error(`${name} grid inner dimension mismatch`);
      }
      for (const v of row) {
        if (!Number.isFinite(v)) throw new Error(`${name} cell not finite`);
      }
    }
  }
}

interface RevisionRow {
  id: string;
  boatId: string;
  sailConfigId: string;
  mode: string;
  parentRevisionId: string | null;
  createdAt: number;
  lineageKind: string;
  lineageMeta: string | null;
  sigma: number | null;
  valueJson: string;
}

function rowToRevision(row: RevisionRow): PolarRevision {
  const lineageMeta = row.lineageMeta
    ? (JSON.parse(row.lineageMeta) as { source?: string; notes?: string })
    : {};
  return {
    id: row.id,
    boatId: row.boatId,
    sailConfigId: row.sailConfigId,
    mode: row.mode,
    parentRevisionId: row.parentRevisionId,
    createdAt: row.createdAt,
    lineage: { kind: row.lineageKind as PolarRevision['lineage']['kind'], ...lineageMeta },
    sigma: row.sigma ?? undefined,
    table: JSON.parse(row.valueJson) as PolarTable,
  };
}

export function insertRevision(db: BetterSQLite3Database, rev: PolarRevision): void {
  validatePolarTable(rev.table);
  const lineageMetaJson =
    rev.lineage.source !== undefined || rev.lineage.notes !== undefined
      ? JSON.stringify({
          ...(rev.lineage.source !== undefined ? { source: rev.lineage.source } : {}),
          ...(rev.lineage.notes !== undefined ? { notes: rev.lineage.notes } : {}),
        })
      : null;
  db.insert(polarRevisions)
    .values({
      id: rev.id,
      boatId: rev.boatId,
      sailConfigId: rev.sailConfigId,
      mode: rev.mode,
      parentRevisionId: rev.parentRevisionId,
      createdAt: rev.createdAt,
      lineageKind: rev.lineage.kind,
      lineageMeta: lineageMetaJson,
      sigma: rev.sigma ?? null,
      valueJson: JSON.stringify(rev.table),
    })
    .run();
}

export function getRevision(db: BetterSQLite3Database, id: string): PolarRevision | undefined {
  const rows = db
    .select()
    .from(polarRevisions)
    .where(eq(polarRevisions.id, id))
    .all() as RevisionRow[];
  return rows[0] ? rowToRevision(rows[0]) : undefined;
}

export interface ListFilter {
  boatId?: BoatId;
  sailConfigId?: string;
  mode?: PolarMode;
}

export function listRevisions(db: BetterSQLite3Database, filter: ListFilter = {}): PolarRevision[] {
  const conds = [];
  if (filter.boatId !== undefined) conds.push(eq(polarRevisions.boatId, filter.boatId));
  if (filter.sailConfigId !== undefined)
    conds.push(eq(polarRevisions.sailConfigId, filter.sailConfigId));
  if (filter.mode !== undefined) conds.push(eq(polarRevisions.mode, filter.mode));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const q = db.select().from(polarRevisions);
  const rows = (where ? q.where(where) : q)
    .orderBy(desc(polarRevisions.createdAt))
    .all() as RevisionRow[];
  return rows.map(rowToRevision);
}
