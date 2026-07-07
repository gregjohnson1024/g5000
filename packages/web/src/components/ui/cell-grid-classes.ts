/**
 * CellGrid class helpers — pure module, no React, no I/O.
 *
 * Provides the token-only Tailwind class strings for CellGrid's outer container,
 * the inner grid element, and individual cells so the mappings can be
 * independently unit-tested without a DOM or React rendering.
 */

/**
 * Responsive column count descriptor.
 * Each key maps to a Tailwind breakpoint: base (no prefix), sm, md, lg.
 * Values must be 1–12; if omitted for a breakpoint the prior value cascades
 * (Tailwind's mobile-first default).
 */
export interface ColsSpec {
  base?: number;
  sm?: number;
  md?: number;
  lg?: number;
}

/** Resolved class string for a given column count (1–12). */
const COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10',
  11: 'grid-cols-11',
  12: 'grid-cols-12',
};

const SM_COLS_CLASS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
  7: 'sm:grid-cols-7',
  8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9',
  10: 'sm:grid-cols-10',
  11: 'sm:grid-cols-11',
  12: 'sm:grid-cols-12',
};

const MD_COLS_CLASS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
  7: 'md:grid-cols-7',
  8: 'md:grid-cols-8',
  9: 'md:grid-cols-9',
  10: 'md:grid-cols-10',
  11: 'md:grid-cols-11',
  12: 'md:grid-cols-12',
};

const LG_COLS_CLASS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
  8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9',
  10: 'lg:grid-cols-10',
  11: 'lg:grid-cols-11',
  12: 'lg:grid-cols-12',
};

/**
 * Build the grid-cols class string for a ColsSpec.
 * Accepts either a plain number (applied at all breakpoints) or a ColsSpec.
 */
export function colsClasses(cols: number | ColsSpec): string {
  if (typeof cols === 'number') {
    return COLS_CLASS[cols] ?? 'grid-cols-3';
  }

  const parts: string[] = [];
  if (cols.base != null) parts.push(COLS_CLASS[cols.base] ?? 'grid-cols-3');
  if (cols.sm != null) parts.push(SM_COLS_CLASS[cols.sm] ?? 'sm:grid-cols-3');
  if (cols.md != null) parts.push(MD_COLS_CLASS[cols.md] ?? 'md:grid-cols-6');
  if (cols.lg != null) parts.push(LG_COLS_CLASS[cols.lg] ?? 'lg:grid-cols-6');
  return parts.join(' ');
}

/**
 * CSS classes for the outer Panel wrapper of CellGrid.
 * The Panel provides: rounded corners, outer border, bg-surface, overflow-hidden
 * so interior r0 cells are clipped to the panel's corner radius.
 */
export const CELL_GRID_WRAPPER_CLASSES =
  '[border-radius:var(--r-panel)] border border-hairline bg-surface overflow-hidden flex flex-col';

/**
 * CSS classes for the inner CSS grid element.
 * gap-0: zero gap (dividers are cell borders, not gaps).
 * divide-hairline: hairline dividers between rows and columns.
 */
export const CELL_GRID_INNER_CLASSES = 'grid gap-0 divide-y divide-hairline';

/**
 * CSS classes applied to each cell wrapper div.
 * Cells are r0 (rounded-none) and their own border is suppressed — the Panel
 * border-hairline outer and divide-* hairlines between cells serve as dividers.
 * The cell wrapper is `relative` so a whole-cell hit target can overlay it.
 */
export const CELL_CLASSES = 'relative';

/**
 * Classes applied to the InstrumentTile inside a cell to suppress the tile's
 * own Panel-style border and radius. The outer CellGrid panel + divide lines
 * handle the visual separation; tiles inside are flush (r0, no own border).
 */
export const CELL_TILE_OVERRIDES = 'rounded-none border-0 h-full';

/**
 * Classes for the whole-cell hit-target overlay (anchor or button).
 * Stretched over the entire cell area; focus ring token-only.
 * z-0 so content remains above for text selection, pointer-events-none fallback
 * is NOT used — we want the whole area to be interactive.
 */
export const CELL_HIT_TARGET_CLASSES =
  'absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus rounded-[inherit]';

/**
 * Return all class strings for a CellGrid in a testable object.
 */
export function cellGridClasses(cols: number | ColsSpec): {
  wrapper: string;
  inner: string;
  cols: string;
  cell: string;
  tileOverrides: string;
  hitTarget: string;
} {
  return {
    wrapper: CELL_GRID_WRAPPER_CLASSES,
    inner: `${CELL_GRID_INNER_CLASSES} ${colsClasses(cols)}`,
    cols: colsClasses(cols),
    cell: CELL_CLASSES,
    tileOverrides: CELL_TILE_OVERRIDES,
    hitTarget: CELL_HIT_TARGET_CLASSES,
  };
}
