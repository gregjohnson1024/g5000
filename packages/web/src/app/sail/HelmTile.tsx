'use client';

/**
 * HelmTile — backward-compatible wrapper around InstrumentTile.
 *
 * Existing callers in CoreStrip and sail/groups/* continue to work unchanged.
 * New code should import InstrumentTile directly from components/ui.
 *
 * Pass `tMs` to enable the built-in StalenessShroud (task-3).
 * `small` maps to size='d3'; default is 'd2' (matches original text-6xl).
 */

import { InstrumentTile, type InstrumentTileProps } from '../../components/ui/InstrumentTile';

export type { InstrumentTileProps as HelmTileProps };

export function HelmTile(props: InstrumentTileProps): React.ReactElement {
  return <InstrumentTile {...props} />;
}
