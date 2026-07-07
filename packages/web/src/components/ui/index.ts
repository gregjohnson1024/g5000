/**
 * components/ui — Tier-1 Primitive Library
 *
 * Token-only, theme-agnostic UI primitives extracted from their named seeds.
 * All components in this folder use design tokens exclusively (no raw hex,
 * no slate-/rose-/emerald- color classes).
 *
 * Phase 3 (task-1): Panel, StatusChip, Button, IconButton, SegmentedControl
 * Phase 3 (task-2): HoldButton, Dialog, ConfirmDialog, Toast
 * Phase 3 (task-3): StalenessShroud, InstrumentTile (replaces HelmTile)
 */

export { Panel } from './Panel';
export type { PanelVariant, PanelEmptyState } from './Panel';

export { StatusChip } from './StatusChip';
export type { StatusChipKind } from './StatusChip';
export { statusChipClasses } from './status-chip-kind';

export { Button, IconButton } from './Button';
export type { ButtonVariant, ButtonSize, ButtonProps, IconButtonProps } from './Button';

export { SegmentedControl } from './SegmentedControl';
export type { Segment, SegmentedControlProps, SegmentedControlSize } from './SegmentedControl';

export { HoldButton } from './HoldButton';
export type { HoldButtonProps } from './HoldButton';

export { holdFraction, isComplete } from './hold-progress';

export { Dialog, ConfirmDialog } from './Dialog';
export type { DialogProps, ConfirmDialogProps } from './Dialog';

export { Toast } from './Toast';
export type { ToastKind, ToastProps } from './Toast';

export {
  stalenessState,
  stalenessClasses,
  ageLabel,
  FRESH_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
} from './staleness';
export type { StalenessState } from './staleness';

export { StalenessShroud } from './StalenessShroud';
export type { StalenessShroudProps } from './StalenessShroud';

export { InstrumentTile } from './InstrumentTile';
export type { InstrumentTileProps, InstrumentSize, InstrumentSeverity } from './InstrumentTile';

export { Takeover } from './Takeover';

export { pickCriticalTakeover } from './takeover-trigger';

export { CellGrid } from './CellGrid';
export type { CellGridProps, CellSpec, ColsSpec } from './CellGrid';

export {
  cellGridClasses,
  colsClasses,
  CELL_GRID_WRAPPER_CLASSES,
  CELL_GRID_INNER_CLASSES,
  CELL_CLASSES,
  CELL_TILE_OVERRIDES,
  CELL_HIT_TARGET_CLASSES,
} from './cell-grid-classes';

export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
