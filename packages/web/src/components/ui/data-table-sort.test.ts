import { describe, it, expect } from 'vitest';
import { sortRows, toggleSort, type SortableRow } from './data-table-sort';

// ---------------------------------------------------------------------------
// sortRows — safety invariants
// ---------------------------------------------------------------------------

interface Row {
  id: number;
  name: string | null;
  value: number | null;
  threat: boolean;
  stale: boolean;
}

function makeRow(partial: Partial<Row>): SortableRow<Row> {
  const data: Row = {
    id: 1,
    name: 'Test',
    value: 0,
    threat: false,
    stale: false,
    ...partial,
  };
  return {
    data,
    pinned: data.threat,
    excluded: data.stale,
  };
}

describe('sortRows — threats pin regardless of sort', () => {
  it('pins threats to the top even when non-threats sort before by value', () => {
    const rows = [
      makeRow({ id: 1, value: 1, threat: false }),
      makeRow({ id: 2, value: 99, threat: true }),
      makeRow({ id: 3, value: 50, threat: false }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'desc');
    // Threat (id=2) must be first despite value=99 also being highest
    expect(sorted[0]!.data.id).toBe(2);
    // Non-threats sorted desc: 50 before 1
    expect(sorted[1]!.data.id).toBe(3);
    expect(sorted[2]!.data.id).toBe(1);
  });

  it('multiple threats float to top, sorted among themselves', () => {
    const rows = [
      makeRow({ id: 1, value: 100, threat: false }),
      makeRow({ id: 2, value: 5, threat: true }),
      makeRow({ id: 3, value: 8, threat: true }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'asc');
    // Threats first (ids 2 and 3), sorted asc: id=2 (value=5) then id=3 (value=8)
    expect(sorted[0]!.data.id).toBe(2);
    expect(sorted[1]!.data.id).toBe(3);
    // Non-threat last
    expect(sorted[2]!.data.id).toBe(1);
  });
});

describe('sortRows — stale excluded', () => {
  it('excludes stale rows from result', () => {
    const rows = [
      makeRow({ id: 1, value: 10, stale: false }),
      makeRow({ id: 2, value: 20, stale: true }),
      makeRow({ id: 3, value: 30, stale: false }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'asc');
    expect(sorted.length).toBe(2);
    expect(sorted.every((r) => !r.data.stale)).toBe(true);
  });

  it('stale threat is also excluded', () => {
    const rows = [
      makeRow({ id: 1, value: 5, stale: false }),
      makeRow({ id: 2, value: 10, stale: true, threat: true }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'asc');
    expect(sorted.length).toBe(1);
    expect(sorted[0]!.data.id).toBe(1);
  });
});

describe('sortRows — null sorts to bottom', () => {
  it('null values sort to bottom in asc direction', () => {
    const rows = [
      makeRow({ id: 1, value: null }),
      makeRow({ id: 2, value: 5 }),
      makeRow({ id: 3, value: 1 }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'asc');
    expect(sorted[sorted.length - 1]!.data.id).toBe(1);
  });

  it('null values sort to bottom in desc direction', () => {
    const rows = [
      makeRow({ id: 1, value: null }),
      makeRow({ id: 2, value: 5 }),
      makeRow({ id: 3, value: 1 }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'desc');
    expect(sorted[sorted.length - 1]!.data.id).toBe(1);
  });

  it('two null values are equal and both at bottom', () => {
    const rows = [
      makeRow({ id: 1, value: null }),
      makeRow({ id: 2, value: null }),
      makeRow({ id: 3, value: 10 }),
    ];
    const sorted = sortRows(rows, (r) => r.data.value, 'asc');
    expect(sorted[0]!.data.id).toBe(3);
    const bottomIds = [sorted[1]!.data.id, sorted[2]!.data.id];
    expect(bottomIds).toContain(1);
    expect(bottomIds).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// toggleSort
// ---------------------------------------------------------------------------

describe('toggleSort', () => {
  it('flips direction when same key clicked', () => {
    const result = toggleSort({ key: 'name', dir: 'asc' }, 'name');
    expect(result).toEqual({ key: 'name', dir: 'desc' });
  });

  it('flips desc → asc when same key clicked', () => {
    const result = toggleSort({ key: 'name', dir: 'desc' }, 'name');
    expect(result).toEqual({ key: 'name', dir: 'asc' });
  });

  it('new key always starts asc', () => {
    const result = toggleSort({ key: 'name', dir: 'desc' }, 'value');
    expect(result).toEqual({ key: 'value', dir: 'asc' });
  });
});
