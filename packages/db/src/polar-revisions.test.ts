import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  validatePolarTable,
  insertRevision,
  getRevision,
  listRevisions,
} from './polar-revisions.js';
import type { PolarRevision, PolarTable } from './defaults.js';

const GOOD: PolarTable = {
  twsBins: [3, 5, 8],
  twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
  boatSpeed: [
    [0, 1, 2, 1.5, 0.5],
    [0, 2, 3, 2.5, 1.0],
    [0, 3, 4, 3.5, 1.5],
  ],
};

function makeDb(): { raw: Database.Database; db: BetterSQLite3Database } {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE polar_revisions (
      id TEXT PRIMARY KEY,
      boat_id TEXT NOT NULL,
      sail_config_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      parent_revision_id TEXT,
      created_at INTEGER NOT NULL,
      lineage_kind TEXT NOT NULL,
      lineage_meta TEXT,
      sigma REAL,
      value_json TEXT NOT NULL
    );
  `);
  return { raw, db: drizzle(raw) };
}

function makeRev(over: Partial<PolarRevision> = {}): PolarRevision {
  return {
    id: '01HVZ000000000000000000001',
    boatId: 'sula',
    sailConfigId: 'default',
    mode: 'default',
    parentRevisionId: null,
    createdAt: 1_700_000_000,
    lineage: { kind: 'manual_edit' },
    table: GOOD,
    ...over,
  };
}

describe('validatePolarTable', () => {
  it('accepts a well-formed grid', () => {
    expect(() => validatePolarTable(GOOD)).not.toThrow();
  });

  it('rejects mismatched dimensions', () => {
    expect(() =>
      validatePolarTable({ ...GOOD, boatSpeed: [[0, 1, 2]] }),
    ).toThrow(/dimension/i);
  });

  it('rejects non-monotonic twsBins', () => {
    expect(() => validatePolarTable({ ...GOOD, twsBins: [5, 3, 8] })).toThrow(/monotonic/i);
  });

  it('rejects non-monotonic twaBins', () => {
    expect(() => validatePolarTable({ ...GOOD, twaBins: [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 4, Math.PI / 4] })).toThrow(/monotonic/i);
  });

  it('rejects twaBins outside [0, π]', () => {
    expect(() => validatePolarTable({ ...GOOD, twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI + 0.1] })).toThrow(/\[0, ?π\]/);
  });

  it('rejects non-finite boatSpeed cell', () => {
    const bad = GOOD.boatSpeed.map((row) => row.slice());
    bad[0]![0] = NaN;
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: bad })).toThrow(/finite/i);
  });

  it('rejects negative boatSpeed', () => {
    const bad = GOOD.boatSpeed.map((row) => row.slice());
    bad[0]![1] = -0.1;
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: bad })).toThrow(/non-negative/i);
  });

  it('rejects heel grid with wrong shape', () => {
    expect(() => validatePolarTable({ ...GOOD, heel: [[0]] })).toThrow(/heel.*dimension/i);
  });

  it('accepts a grid with valid heel and leeway', () => {
    const sameShape = GOOD.boatSpeed.map((row) => row.map(() => 0.1));
    expect(() =>
      validatePolarTable({ ...GOOD, heel: sameShape, leeway: sameShape }),
    ).not.toThrow();
  });

  it('rejects empty bins', () => {
    expect(() => validatePolarTable({ ...GOOD, twsBins: [] })).toThrow(/empty/i);
  });
});

describe('insertRevision / getRevision / listRevisions', () => {
  let env: ReturnType<typeof makeDb>;
  beforeEach(() => {
    env = makeDb();
  });

  it('round-trips a revision', () => {
    const rev = makeRev();
    insertRevision(env.db, rev);
    const back = getRevision(env.db, rev.id);
    expect(back).toEqual(rev);
  });

  it('returns undefined for unknown id', () => {
    expect(getRevision(env.db, 'nope')).toBeUndefined();
  });

  it('lists by (boatId, sailConfigId, mode) newest-first', () => {
    insertRevision(env.db, makeRev({ id: 'a', createdAt: 100 }));
    insertRevision(env.db, makeRev({ id: 'b', createdAt: 200 }));
    insertRevision(env.db, makeRev({ id: 'c', createdAt: 150, sailConfigId: 'other' }));
    const got = listRevisions(env.db, { boatId: 'sula', sailConfigId: 'default', mode: 'default' });
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('rejects an invalid grid at insert time', () => {
    const bad = makeRev({ table: { ...GOOD, twsBins: [5, 3] } });
    expect(() => insertRevision(env.db, bad)).toThrow(/monotonic|dimension/i);
  });
});
