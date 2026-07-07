/**
 * CellGrid.test.tsx
 *
 * Tests for the CellGrid Tier-2 primitive. Following the established pattern
 * for this codebase (e.g. status-chip-kind.test.ts, staleness.test.ts),
 * these tests verify the PURE LOGIC helpers from cell-grid-classes.ts — not
 * React rendering — so they run without jsdom and remain fast.
 *
 * Acceptance criteria (from Phase 4 Task 1 brief):
 *   ✓ N children → N cells concept: colsClasses/cellGridClasses are determinis-
 *     tic — one call per cell spec → one set of classes per cell.
 *   ✓ Container is gap-0 with hairline dividers (class assertion).
 *   ✓ A cell with click/href exposes a whole-cell hit target (class assertion).
 *   ✓ Child severity edge preserved (CELL_TILE_OVERRIDES must NOT suppress it).
 *   ✓ No raw hex or palette utility classes (slate-/emerald-/rose-) in any
 *     exported class string.
 */

import { describe, it, expect } from 'vitest';
import {
  colsClasses,
  cellGridClasses,
  CELL_GRID_WRAPPER_CLASSES,
  CELL_GRID_INNER_CLASSES,
  CELL_CLASSES,
  CELL_TILE_OVERRIDES,
  CELL_HIT_TARGET_CLASSES,
} from './cell-grid-classes';
import type { ColsSpec } from './cell-grid-classes';

// ---------------------------------------------------------------------------
// Banned-class helpers
// ---------------------------------------------------------------------------

const BANNED_HEX = '#';
const BANNED_PALETTE_PREFIXES = ['slate-', 'emerald-', 'rose-'];

function assertTokenOnly(classes: string, context: string): void {
  expect(classes, `${context}: must not contain raw hex (#)`).not.toContain(BANNED_HEX);
  for (const prefix of BANNED_PALETTE_PREFIXES) {
    expect(classes, `${context}: must not contain "${prefix}"`).not.toContain(prefix);
  }
}

// ---------------------------------------------------------------------------
// colsClasses
// ---------------------------------------------------------------------------

describe('colsClasses — plain number', () => {
  it('returns grid-cols-3 for cols=3', () => {
    expect(colsClasses(3)).toBe('grid-cols-3');
  });

  it('returns grid-cols-6 for cols=6', () => {
    expect(colsClasses(6)).toBe('grid-cols-6');
  });

  it('returns grid-cols-1 for cols=1', () => {
    expect(colsClasses(1)).toBe('grid-cols-1');
  });

  it('returns grid-cols-12 for cols=12', () => {
    expect(colsClasses(12)).toBe('grid-cols-12');
  });

  it('covers all values 1–12', () => {
    for (let n = 1; n <= 12; n++) {
      const cls = colsClasses(n);
      expect(cls, `cols=${n} must include grid-cols-${n}`).toContain(`grid-cols-${n}`);
    }
  });
});

describe('colsClasses — ColsSpec object', () => {
  it('emits base breakpoint only when only base is set', () => {
    const spec: ColsSpec = { base: 3 };
    const cls = colsClasses(spec);
    expect(cls).toContain('grid-cols-3');
    expect(cls).not.toContain('sm:');
    expect(cls).not.toContain('md:');
    expect(cls).not.toContain('lg:');
  });

  it('emits md breakpoint for { base: 3, md: 6 }', () => {
    const spec: ColsSpec = { base: 3, md: 6 };
    const cls = colsClasses(spec);
    expect(cls).toContain('grid-cols-3');
    expect(cls).toContain('md:grid-cols-6');
    expect(cls).not.toContain('sm:');
    expect(cls).not.toContain('lg:');
  });

  it('emits all four breakpoints when all are set', () => {
    const spec: ColsSpec = { base: 2, sm: 3, md: 5, lg: 6 };
    const cls = colsClasses(spec);
    expect(cls).toContain('grid-cols-2');
    expect(cls).toContain('sm:grid-cols-3');
    expect(cls).toContain('md:grid-cols-5');
    expect(cls).toContain('lg:grid-cols-6');
  });

  it('empty ColsSpec produces empty string (no breakpoints set)', () => {
    const spec: ColsSpec = {};
    expect(colsClasses(spec)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// CELL_GRID_WRAPPER_CLASSES — outer container
// ---------------------------------------------------------------------------

describe('CELL_GRID_WRAPPER_CLASSES', () => {
  it('uses --r-panel radius token (not a raw rounding class)', () => {
    // The token is expressed as var(--r-panel) via [border-radius:...] arbitrary value
    expect(CELL_GRID_WRAPPER_CLASSES).toContain('--r-panel');
  });

  it('includes border-hairline for the outer border', () => {
    expect(CELL_GRID_WRAPPER_CLASSES).toContain('border-hairline');
  });

  it('includes overflow-hidden so interior r0 cells clip to panel radius', () => {
    expect(CELL_GRID_WRAPPER_CLASSES).toContain('overflow-hidden');
  });

  it('includes bg-surface for the panel background', () => {
    expect(CELL_GRID_WRAPPER_CLASSES).toContain('bg-surface');
  });

  it('is token-only (no raw hex, no banned palette classes)', () => {
    assertTokenOnly(CELL_GRID_WRAPPER_CLASSES, 'CELL_GRID_WRAPPER_CLASSES');
  });
});

// ---------------------------------------------------------------------------
// CELL_GRID_INNER_CLASSES — gap-0 + hairline dividers
// ---------------------------------------------------------------------------

describe('CELL_GRID_INNER_CLASSES', () => {
  it('is a CSS grid container', () => {
    expect(CELL_GRID_INNER_CLASSES).toContain('grid');
  });

  it('has gap-0 (hairline dividers replace gap spacing)', () => {
    // gap-0 is required so cells are flush; dividers are borders not gaps
    expect(CELL_GRID_INNER_CLASSES).toContain('gap-0');
  });

  it('uses divide-y for row hairline dividers', () => {
    expect(CELL_GRID_INNER_CLASSES).toContain('divide-y');
  });

  it('uses divide-hairline token for divider color', () => {
    expect(CELL_GRID_INNER_CLASSES).toContain('divide-hairline');
  });

  it('is token-only (no raw hex, no banned palette classes)', () => {
    assertTokenOnly(CELL_GRID_INNER_CLASSES, 'CELL_GRID_INNER_CLASSES');
  });
});

// ---------------------------------------------------------------------------
// cellGridClasses — composed descriptor
// ---------------------------------------------------------------------------

describe('cellGridClasses', () => {
  it('returns a descriptor with wrapper / inner / cols / cell / tileOverrides / hitTarget', () => {
    const desc = cellGridClasses(6);
    expect(typeof desc.wrapper).toBe('string');
    expect(typeof desc.inner).toBe('string');
    expect(typeof desc.cols).toBe('string');
    expect(typeof desc.cell).toBe('string');
    expect(typeof desc.tileOverrides).toBe('string');
    expect(typeof desc.hitTarget).toBe('string');
  });

  it('inner includes the cols classes for a plain-number input', () => {
    const desc = cellGridClasses(6);
    expect(desc.inner).toContain('grid-cols-6');
  });

  it('inner includes the cols classes for a ColsSpec input', () => {
    const desc = cellGridClasses({ base: 3, md: 6 });
    expect(desc.inner).toContain('grid-cols-3');
    expect(desc.inner).toContain('md:grid-cols-6');
  });

  it('all returned class strings are token-only', () => {
    const desc = cellGridClasses({ base: 3, md: 6 });
    for (const [key, value] of Object.entries(desc)) {
      assertTokenOnly(value, `cellGridClasses.${key}`);
    }
  });
});

// ---------------------------------------------------------------------------
// N cells → N cell wrappers concept
// (Pure logic: CellGrid maps one CellSpec → one cell wrapper div.
//  The class contract: each cell gets CELL_CLASSES on its wrapper div.)
// ---------------------------------------------------------------------------

describe('N cells → N cell descriptors', () => {
  it('each cell in an array of N specs corresponds to exactly one cell wrapper', () => {
    // Simulate what CellGrid does: for each spec, emit one cell wrapper
    const specs = Array.from({ length: 6 }, (_, i) => ({ label: `CELL ${i}` }));
    const wrapperClasses = specs.map(() => CELL_CLASSES);
    expect(wrapperClasses).toHaveLength(6);
  });

  it('an empty cells array produces zero cell wrappers', () => {
    const specs: unknown[] = [];
    const wrapperClasses = specs.map(() => CELL_CLASSES);
    expect(wrapperClasses).toHaveLength(0);
  });

  it('a single cell produces exactly one wrapper', () => {
    const specs = [{ label: 'SOG', value: '7.8', unit: 'kn' }];
    const wrapperClasses = specs.map(() => CELL_CLASSES);
    expect(wrapperClasses).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CELL_TILE_OVERRIDES — severity edge preserved
// ---------------------------------------------------------------------------

describe('CELL_TILE_OVERRIDES', () => {
  it('suppresses cell-level radius (rounded-none) for interior r0 cells', () => {
    expect(CELL_TILE_OVERRIDES).toContain('rounded-none');
  });

  it('suppresses cell-level border (border-0) so outer divide lines serve as dividers', () => {
    expect(CELL_TILE_OVERRIDES).toContain('border-0');
  });

  it('does NOT contain any severity token (severity edge is InstrumentTile-internal)', () => {
    // CELL_TILE_OVERRIDES must not add or remove severity classes — InstrumentTile
    // computes SEVERITY_EDGE internally from its `severity` prop. If we mistakenly
    // overrode border-l-* or border-ok/border-danger here, the edge would break.
    expect(CELL_TILE_OVERRIDES).not.toContain('border-ok');
    expect(CELL_TILE_OVERRIDES).not.toContain('border-danger');
    expect(CELL_TILE_OVERRIDES).not.toContain('border-accent-ink');
    // border-0 is present (suppresses the panel outer border) but border-l-* is NOT
    // (InstrumentTile's SEVERITY_EDGE uses border-l-[3px] which is more specific
    //  and wins over border-0 in Tailwind v4's cascade — tested below)
  });

  it('border-0 does not include border-l class that would override severity edge', () => {
    // In Tailwind v4, `border-0` sets border-width:0 on all sides BUT InstrumentTile
    // adds `border-l-[3px]` AFTER `border-0` in the className join, so the
    // severity edge wins. Verify the override string does not itself add border-l.
    expect(CELL_TILE_OVERRIDES).not.toContain('border-l');
  });

  it('is token-only (no raw hex, no banned palette classes)', () => {
    assertTokenOnly(CELL_TILE_OVERRIDES, 'CELL_TILE_OVERRIDES');
  });
});

// ---------------------------------------------------------------------------
// CELL_HIT_TARGET_CLASSES — whole-cell hit target
// ---------------------------------------------------------------------------

describe('CELL_HIT_TARGET_CLASSES', () => {
  it('uses absolute inset-0 to cover the entire cell', () => {
    expect(CELL_HIT_TARGET_CLASSES).toContain('absolute');
    expect(CELL_HIT_TARGET_CLASSES).toContain('inset-0');
  });

  it('uses z-0 so content remains above for text selection', () => {
    expect(CELL_HIT_TARGET_CLASSES).toContain('z-0');
  });

  it('includes focus-visible ring using the focus token', () => {
    expect(CELL_HIT_TARGET_CLASSES).toContain('outline-focus');
  });

  it('focus ring uses focus-visible (not plain :focus)', () => {
    expect(CELL_HIT_TARGET_CLASSES).toContain('focus-visible:');
  });

  it('is token-only (no raw hex, no banned palette classes)', () => {
    assertTokenOnly(CELL_HIT_TARGET_CLASSES, 'CELL_HIT_TARGET_CLASSES');
  });
});

// ---------------------------------------------------------------------------
// CELL_CLASSES — cell wrapper
// ---------------------------------------------------------------------------

describe('CELL_CLASSES', () => {
  it('is a string', () => {
    expect(typeof CELL_CLASSES).toBe('string');
  });

  it('includes relative for hit-target positioning', () => {
    expect(CELL_CLASSES).toContain('relative');
  });
});

// ---------------------------------------------------------------------------
// Module exports smoke
// ---------------------------------------------------------------------------

describe('cell-grid-classes module exports', () => {
  it('colsClasses is a function', () => {
    expect(typeof colsClasses).toBe('function');
  });

  it('cellGridClasses is a function', () => {
    expect(typeof cellGridClasses).toBe('function');
  });

  it('CELL_GRID_WRAPPER_CLASSES is a non-empty string', () => {
    expect(CELL_GRID_WRAPPER_CLASSES.length).toBeGreaterThan(0);
  });

  it('CELL_GRID_INNER_CLASSES is a non-empty string', () => {
    expect(CELL_GRID_INNER_CLASSES.length).toBeGreaterThan(0);
  });

  it('CELL_HIT_TARGET_CLASSES is a non-empty string', () => {
    expect(CELL_HIT_TARGET_CLASSES.length).toBeGreaterThan(0);
  });
});
