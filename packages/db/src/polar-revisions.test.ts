import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { ulid } from 'ulid';
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
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: [[0, 1, 2]] })).toThrow(/dimension/i);
  });

  it('rejects non-monotonic twsBins', () => {
    expect(() => validatePolarTable({ ...GOOD, twsBins: [5, 3, 8] })).toThrow(/monotonic/i);
  });

  it('rejects non-monotonic twaBins', () => {
    expect(() =>
      validatePolarTable({
        ...GOOD,
        twaBins: [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 4, Math.PI / 4],
      }),
    ).toThrow(/monotonic/i);
  });

  it('rejects twaBins outside [0, π]', () => {
    expect(() =>
      validatePolarTable({
        ...GOOD,
        twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI + 0.1],
      }),
    ).toThrow(/\[0, ?π\]/);
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
    expect(() => validatePolarTable({ ...GOOD, heel: sameShape, leeway: sameShape })).not.toThrow();
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

  it('ULIDs generated sequentially are lex-increasing', async () => {
    // ULIDs are designed to be lex-sortable in time order at millisecond
    // resolution. This guards against accidentally using a generator that
    // breaks that property. We sleep 1ms between calls to guarantee separate
    // millisecond ticks (the within-ms ordering relies on randomness and is
    // not part of the lex-sort guarantee from the base `ulid()` factory).
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(ulid());
      await new Promise((r) => setTimeout(r, 1));
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it('listRevisions returns revisions linked by parentRevisionId', () => {
    // Insert revision A (parent=null), B (parent=A.id), C (parent=B.id).
    // listRevisions returns all 3 newest-first; walking parentRevisionId
    // from C reconstructs the chain C → B → A.
    const a = makeRev({ id: 'A', createdAt: 100, parentRevisionId: null });
    const b = makeRev({ id: 'B', createdAt: 200, parentRevisionId: 'A' });
    const c = makeRev({ id: 'C', createdAt: 300, parentRevisionId: 'B' });
    insertRevision(env.db, a);
    insertRevision(env.db, b);
    insertRevision(env.db, c);

    const got = listRevisions(env.db, {
      boatId: 'sula',
      sailConfigId: 'default',
      mode: 'default',
    });
    expect(got.map((r) => r.id)).toEqual(['C', 'B', 'A']);

    // Walk the parent chain starting from C.
    const byId = new Map(got.map((r) => [r.id, r] as const));
    const chain: string[] = [];
    let cursor: string | null = 'C';
    while (cursor !== null) {
      chain.push(cursor);
      cursor = byId.get(cursor)?.parentRevisionId ?? null;
    }
    expect(chain).toEqual(['C', 'B', 'A']);
  });
});

describe('PolarTable JSON round-trip (property)', () => {
  /** Inline bilinear matching packages/compute/src/polars/math.ts semantics.
   *  Inlined to avoid pulling @g5000/compute (which depends on @g5000/db) and
   *  creating a circular import. The semantics are kept identical so the
   *  round-trip equality assertion is meaningful for downstream consumers. */
  function bilinear(
    xBins: number[],
    yBins: number[],
    grid: number[][],
    x: number,
    y: number,
  ): number {
    const xi = locate(xBins, x);
    const yi = locate(yBins, y);
    const x0 = xBins[xi.lo]!;
    const x1 = xBins[xi.hi]!;
    const y0 = yBins[yi.lo]!;
    const y1 = yBins[yi.hi]!;
    const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const c00 = grid[xi.lo]![yi.lo]!;
    const c01 = grid[xi.lo]![yi.hi]!;
    const c10 = grid[xi.hi]![yi.lo]!;
    const c11 = grid[xi.hi]![yi.hi]!;
    return c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy;
  }
  function locate(bins: number[], v: number): { lo: number; hi: number } {
    if (bins.length === 0) return { lo: 0, hi: 0 };
    if (v <= bins[0]!) return { lo: 0, hi: 0 };
    if (v >= bins[bins.length - 1]!) {
      return { lo: bins.length - 1, hi: bins.length - 1 };
    }
    for (let i = 0; i < bins.length - 1; i++) {
      if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
    }
    return { lo: bins.length - 1, hi: bins.length - 1 };
  }

  /** Build a strictly increasing array of `count` values in [min, max] by
   *  sorting `count` floats and rejecting duplicates via a min-gap. */
  const strictlyIncreasing = (count: number, min: number, max: number) =>
    fc
      .uniqueArray(fc.double({ min, max, noNaN: true, noDefaultInfinity: true }), {
        minLength: count,
        maxLength: count,
      })
      .map((arr) => arr.slice().sort((a, b) => a - b))
      .filter((arr) => {
        for (let i = 1; i < arr.length; i++) {
          if (!(arr[i]! > arr[i - 1]!)) return false;
        }
        return true;
      });

  const polarArb = fc
    .tuple(
      // twsBins: strictly increasing m/s in (0, 30].
      fc.integer({ min: 2, max: 6 }).chain((n) => strictlyIncreasing(n, 0.1, 30)),
      // twaBins: strictly increasing radians in [0, π].
      fc.integer({ min: 2, max: 8 }).chain((n) => strictlyIncreasing(n, 0, Math.PI)),
    )
    .chain(([twsBins, twaBins]) =>
      fc
        .array(
          fc.array(fc.double({ min: 0, max: 15, noNaN: true, noDefaultInfinity: true }), {
            minLength: twaBins.length,
            maxLength: twaBins.length,
          }),
          { minLength: twsBins.length, maxLength: twsBins.length },
        )
        .map((boatSpeed): PolarTable => ({ twsBins, twaBins, boatSpeed })),
    );

  it('JSON.parse(JSON.stringify(table)) preserves structure and interpolation', () => {
    fc.assert(
      fc.property(
        polarArb,
        fc.double({ min: 0, max: 35, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: Math.PI, noNaN: true, noDefaultInfinity: true }),
        (table, tws, twaAbs) => {
          // Sanity: the generator must produce grids the validator accepts.
          validatePolarTable(table);
          const roundTripped = JSON.parse(JSON.stringify(table)) as PolarTable;
          // Structural equality.
          expect(roundTripped).toEqual(table);
          // Bilinear lookup is bit-identical between original and round-tripped
          // grids — JSON.stringify must not lose precision for the doubles we
          // generate, and identical inputs must produce identical floats.
          const a = bilinear(table.twsBins, table.twaBins, table.boatSpeed, tws, twaAbs);
          const b = bilinear(
            roundTripped.twsBins,
            roundTripped.twaBins,
            roundTripped.boatSpeed,
            tws,
            twaAbs,
          );
          expect(b).toBe(a);
        },
      ),
    );
  });
});
