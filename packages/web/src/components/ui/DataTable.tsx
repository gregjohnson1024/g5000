/**
 * DataTable — Tier-1 primitive.
 *
 * Seeded from TargetsTable. Generalised while preserving all safety invariants:
 *   - Pinned rows (threats-always-on-top) float to the top regardless of sort.
 *   - Stale rows excluded before sorting.
 *   - null values sort to the bottom.
 *   - Units in column headers once — NOT repeated in every cell.
 *   - Mono right-aligned numerics.
 *   - Sticky header.
 *   - 36px rows on pointer:fine, 44px on touch (two named densities).
 *   - Row → BottomSheet on phone (when onRowDetail is provided).
 *
 * Token-only. No raw hex. No slate-* classes.
 */

'use client';

import { useState, useCallback } from 'react';
import { sortRows, toggleSort, type SortDir, type SortableRow } from './data-table-sort';
import { BottomSheet } from './BottomSheet';

export interface ColumnDef<T> {
  /** Stable key matching sortKey type */
  key: string;
  /** Header label */
  label: string;
  /** Unit shown in header (e.g. "NM", "kn") — not repeated in cells */
  unit?: string;
  /** Cell alignment — defaults to 'right' for numeric columns */
  align?: 'left' | 'right';
  /** Render the cell content for this row */
  render: (row: T) => React.ReactNode;
  /** Extract a sort-comparable value (null → sort to bottom) */
  sortValue?: (row: T) => number | string | null;
  /** Sortable? (default true if sortValue provided) */
  sortable?: boolean;
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Raw row data */
  rows: T[];
  /** Unique key for each row */
  rowKey: (row: T) => string | number;
  /**
   * Predicate: rows where this returns true are pinned to the top.
   * (Preserves threats-always-on-top invariant from TargetsTable.)
   */
  pinPredicate?: (row: T) => boolean;
  /**
   * Predicate: rows where this returns true are excluded from the table.
   * (Preserves stale-target exclusion from TargetsTable.)
   */
  excludePredicate?: (row: T) => boolean;
  /** Default sort key (first column key if not provided) */
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  /** Called when a row is clicked. On phone, opens a BottomSheet with detail. */
  onRowClick?: (row: T) => void;
  /**
   * If provided, a BottomSheet is rendered on row click (phone-pattern).
   * Children are the detail contents.
   */
  onRowDetail?: (row: T) => React.ReactNode;
  /** Currently selected row key */
  selectedKey?: string | number;
  className?: string;
  /** 'default' = 36px/pointer:fine 44px/touch. 'dense' = always 36px. */
  density?: 'default' | 'dense';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pinPredicate,
  excludePredicate,
  defaultSortKey,
  defaultSortDir = 'asc',
  onRowClick,
  onRowDetail,
  selectedKey,
  className = '',
  density = 'default',
}: DataTableProps<T>): React.ReactElement {
  const firstSortableCol = columns.find((c) => c.sortValue);
  const initialKey = defaultSortKey ?? firstSortableCol?.key ?? '';
  const [sortKey, setSortKey] = useState<string>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);
  const [detailRow, setDetailRow] = useState<T | null>(null);

  const handleSort = useCallback(
    (key: string) => {
      const next = toggleSort({ key: sortKey, dir: sortDir }, key);
      setSortKey(next.key);
      setSortDir(next.dir);
    },
    [sortKey, sortDir],
  );

  const handleRowClick = useCallback(
    (row: T) => {
      onRowClick?.(row);
      if (onRowDetail) setDetailRow(row);
    },
    [onRowClick, onRowDetail],
  );

  // Build sortable row wrappers
  const sortableRows: SortableRow<T>[] = rows.map((r) => ({
    data: r,
    pinned: pinPredicate?.(r) ?? false,
    excluded: excludePredicate?.(r) ?? false,
  }));

  // Find the active column's sortValue extractor
  const activeCol = columns.find((c) => c.key === sortKey);
  const getValue = (sr: SortableRow<T>): number | string | null =>
    activeCol?.sortValue?.(sr.data) ?? null;

  const sorted = sortRows(sortableRows, getValue, sortDir);

  const rowHeightClass =
    density === 'dense'
      ? 'h-9' // always 36px
      : 'h-9 sm:h-9 touch-none'; // 36px on pointer:fine via Tailwind, 44px on touch via min-h

  return (
    <>
      <div className={`overflow-x-auto ${className}`}>
        <table className="w-full text-body-sm font-mono border-collapse">
          <thead className="sticky top-0 bg-surface-raised z-10">
            <tr className="border-b border-hairline">
              {columns.map((col) => {
                const isSortable = col.sortable !== false && !!col.sortValue;
                const isActive = sortKey === col.key;
                const align = col.align ?? 'right';
                return (
                  <th
                    key={col.key}
                    className={[
                      'py-2 px-2 text-caption text-ink-2 font-semibold select-none whitespace-nowrap',
                      align === 'left' ? 'text-left' : 'text-right',
                      isSortable ? 'cursor-pointer hover:text-ink transition-colors' : '',
                      isActive ? 'text-ink' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={isSortable ? () => handleSort(col.key) : undefined}
                    aria-sort={
                      isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {col.label}
                    {col.unit && <span className="ml-1 font-normal text-ink-3">({col.unit})</span>}
                    {isActive && (
                      <span className="ml-1 text-caption text-accent-ink" aria-hidden="true">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ data, pinned }) => {
              const key = rowKey(data);
              const isSelected = selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={() => handleRowClick(data)}
                  className={[
                    'border-b border-hairline transition-colors',
                    density === 'default' ? 'min-h-[36px] @touch:min-h-[44px]' : '',
                    onRowClick || onRowDetail ? 'cursor-pointer hover:bg-surface-raised' : '',
                    isSelected ? 'bg-surface-raised' : '',
                    pinned ? 'text-danger' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {columns.map((col) => {
                    const align = col.align ?? 'right';
                    return (
                      <td
                        key={col.key}
                        className={[
                          'py-2 px-2 tabular-nums',
                          align === 'left' ? 'text-left' : 'text-right',
                        ].join(' ')}
                      >
                        {col.render(data)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-ink-4 text-body-sm">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone detail sheet */}
      {onRowDetail && detailRow !== null && (
        <BottomSheet open={true} onClose={() => setDetailRow(null)}>
          {onRowDetail(detailRow)}
        </BottomSheet>
      )}
    </>
  );
}
