import type { Observable } from 'rxjs';
import type { DayBaseColor } from './colors.js';

/** Number-tile grids for v1. 'fields+graph' is intentionally deferred. */
export type GridKind = '1' | '2' | '3' | '4' | '6';

/** Max tiles a grid can show. */
export const GRID_CAPACITY: Record<GridKind, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '6': 6,
};

/** Display units the renderer converts SI samples into. */
export type DisplayUnit = 'kn' | 'deg' | 'degT' | 'm' | 'ft' | 'pct' | 'v' | 'raw';

export interface MastThreshold {
  /** Bounds are compared against the value AFTER conversion to the tile's units. */
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  color: 'green' | 'amber' | 'red' | 'default';
}

export interface MastTile {
  /** Channel name; must exist in @g5000/core Channels. */
  field: string;
  label: string;
  units: DisplayUnit;
  /** 0..3 decimal places. */
  decimals: number;
  thresholds?: MastThreshold[];
}

/** Coarse boat mode used for context-aware page selection. */
export type BoatMode = 'upwind' | 'downwind' | 'reach' | 'stationary' | 'delivery';

export type PageCondition = { mode: BoatMode } | { always: true };

export interface MastPage {
  id: string;
  label: string;
  grid: GridKind;
  /** When omitted, the page is only reachable via override. */
  condition?: PageCondition;
  tiles: MastTile[];
}

export interface MastLayout {
  version: 1;
  pages: MastPage[];
}

/**
 * Server runtime contract implemented by apps/g5000 MastService and consumed by
 * web API routes via the shared-singleton holder. Kept here so packages/web
 * never imports apps/g5000.
 */
export interface MastRuntime {
  readonly layout$: Observable<MastLayout>;
  readonly override$: Observable<string | null>;
  getLayout(): MastLayout;
  getOverride(): string | null;
  setOverride(pageId: string | null): void;
  readonly brightness$: Observable<number>;
  getBrightness(): number;
  readonly nightMode$: Observable<boolean>;
  getNightMode(): boolean;
  readonly dayBaseColor$: Observable<DayBaseColor>;
  getDayBaseColor(): DayBaseColor;
}
