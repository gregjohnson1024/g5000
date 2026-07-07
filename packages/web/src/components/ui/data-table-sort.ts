/**
 * data-table-sort.ts — Pure sortable-table helper for DataTable.
 *
 * Extracted from TargetsTable's sort logic. Preserves the safety invariants
 * verbatim:
 *   - Pinned rows ALWAYS float to the top regardless of sort column / direction.
 *   - Stale rows are excluded before sorting (stale-exclusion).
 *   - null values sort to the bottom of whichever direction is active.
 *
 * Pure functions — no React, no DOM. Fully testable in isolation.
 */

export type SortDir = 'asc' | 'desc';

export interface SortableRow<T> {
  data: T;
  /** Pinned rows float to the top regardless of sort. */
  pinned: boolean;
  /** Excluded rows are removed before sorting. */
  excluded: boolean;
}

/**
 * Sort rows applying the three safety invariants.
 *
 * @param rows      the full row set (includes excluded rows — they are removed here)
 * @param getValue  extract the sort key value for a row (return null → sort to bottom)
 * @param dir       sort direction
 */
export function sortRows<T>(
  rows: readonly SortableRow<T>[],
  getValue: (row: SortableRow<T>) => number | string | null,
  dir: SortDir,
): SortableRow<T>[] {
  // 1. Exclude stale/filtered rows.
  const visible = rows.filter((r) => !r.excluded);

  // 2. Partition: pinned vs non-pinned.
  const pinned = visible.filter((r) => r.pinned);
  const rest = visible.filter((r) => !r.pinned);

  // 3. Sort within each partition.
  const comparator = makeComparator(getValue, dir);
  pinned.sort(comparator);
  rest.sort(comparator);

  // 4. Pinned rows first, then sorted rest.
  return [...pinned, ...rest];
}

function makeComparator<T>(
  getValue: (row: SortableRow<T>) => number | string | null,
  dir: SortDir,
): (a: SortableRow<T>, b: SortableRow<T>) => number {
  return (a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    // null sorts to the bottom regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const raw =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
    return dir === 'asc' ? raw : -raw;
  };
}

/**
 * Toggle sort direction: if same key → flip dir; if new key → 'asc'.
 */
export function toggleSort<K extends string>(
  current: { key: K; dir: SortDir },
  clicked: K,
): { key: K; dir: SortDir } {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clicked, dir: 'asc' };
}
