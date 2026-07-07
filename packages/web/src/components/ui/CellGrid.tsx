'use client';

import type { ReactNode } from 'react';
import { InstrumentTile } from './InstrumentTile';
import type { InstrumentTileProps } from './InstrumentTile';
import {
  cellGridClasses,
  CELL_CLASSES,
  CELL_TILE_OVERRIDES,
  CELL_HIT_TARGET_CLASSES,
} from './cell-grid-classes';
import type { ColsSpec } from './cell-grid-classes';

/**
 * CellGrid — Tier-2 glance-surface container (proposal §7.1).
 *
 * A hairline-divided, gap-0 grid of InstrumentTile cells inside a rounded
 * Panel-style wrapper. Designed for the helm CoreStrip, race readouts, mast,
 * and any glance surface that needs a flush instrument wall.
 *
 * Key properties (per proposal §7.1 and §4.5):
 *   - The outer wrapper has --r-panel corner radius and overflow-hidden, so
 *     interior r0 cells are clipped to the rounded corners automatically.
 *   - Interior cells are r0 (rounded-none): hairline-divided, gap-0, no
 *     individual cell borders — the Panel outer border and CSS divide lines
 *     serve as all dividers.
 *   - Each cell's InstrumentTile 3px severity left-edge (SEVERITY_EDGE) is
 *     preserved because InstrumentTile handles it internally.
 *   - Cells with href or onClick receive a whole-cell hit target (44px minimum
 *     height is enforced by InstrumentTile's natural content height at d2/d3
 *     sizes; callers should pass `size='d2'` or larger on glance surfaces).
 *   - Slot-stable: absent values render '—' in reserved space (delegated to
 *     InstrumentTile — no gating on value presence here).
 *   - Responsive column count via `cols` prop:
 *       cols={6}                    → 6 columns at all breakpoints
 *       cols={{ base: 3, md: 6 }}   → 3 on mobile, 6 on md+
 *
 * Compose InstrumentTile — does NOT reinvent it. Each CellSpec extends
 * InstrumentTileProps and adds optional `href` / `onClick` for the hit target
 * and an optional `key` for React list rendering.
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- color classes.
 */

export type { ColsSpec };

export interface CellSpec extends InstrumentTileProps {
  /**
   * Optional React key for list rendering. When omitted, the cell's index
   * is used as the fallback key (safe for a fixed-slot grid).
   */
  key?: string;
  /**
   * When provided, the whole-cell hit target is rendered as an <a> element.
   * Takes priority over onClick when both are set.
   */
  href?: string;
  /**
   * When provided (and href is absent), the whole-cell hit target is rendered
   * as a <button> element. The handler receives the cell index.
   */
  onClick?: () => void;
  /**
   * Extra children rendered inside the InstrumentTile (passed through to
   * InstrumentTileProps.children).
   */
  children?: ReactNode;
}

export interface CellGridProps {
  /** Ordered list of cell specs — each becomes one InstrumentTile cell. */
  cells: CellSpec[];
  /**
   * Responsive column count.
   *   number  — same count at all breakpoints.
   *   ColsSpec — e.g. { base: 3, md: 6 } for mobile→desktop responsive.
   */
  cols: number | ColsSpec;
  /**
   * Optional grid label rendered in the Panel header voice
   * (uppercase, ink-2, same as Panel's label slot).
   * When absent the header row is suppressed.
   */
  label?: string;
  /** Additional className for the outermost wrapper element. */
  className?: string;
  /**
   * Optional data-testid applied to the outermost wrapper for test selection.
   */
  'data-testid'?: string;
}

// ---------------------------------------------------------------------------

export function CellGrid({
  cells,
  cols,
  label,
  className,
  'data-testid': testId,
}: CellGridProps): React.ReactElement {
  const classes = cellGridClasses(cols);

  return (
    <div className={[classes.wrapper, className].filter(Boolean).join(' ')} data-testid={testId}>
      {/* Optional Panel-style header */}
      {label && (
        <div className="px-3 pt-3 pb-2 border-b border-hairline flex-shrink-0">
          <span className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2">
            {label}
          </span>
        </div>
      )}

      {/* Inner CSS grid — gap-0, hairline dividers between rows and columns */}
      <div className={classes.inner}>
        {cells.map((cellSpec, idx) => {
          const {
            key,
            href,
            onClick,
            children: cellChildren,
            className: cellClassName,
            ...tileProps
          } = cellSpec;

          const hasTarget = href != null || onClick != null;

          return (
            <div
              key={key ?? idx}
              className={[CELL_CLASSES, cellClassName].filter(Boolean).join(' ')}
              data-cell-index={idx}
            >
              {/* Whole-cell hit target — rendered below tile content via z-0 */}
              {hasTarget &&
                (href != null ? (
                  <a
                    href={href}
                    className={CELL_HIT_TARGET_CLASSES}
                    aria-label={tileProps.label}
                    tabIndex={0}
                  />
                ) : (
                  <button
                    type="button"
                    className={CELL_HIT_TARGET_CLASSES}
                    aria-label={tileProps.label}
                    onClick={onClick}
                  />
                ))}

              {/* InstrumentTile with border/radius overrides for interior cells */}
              <InstrumentTile {...tileProps} className={CELL_TILE_OVERRIDES}>
                {cellChildren}
              </InstrumentTile>
            </div>
          );
        })}
      </div>
    </div>
  );
}
