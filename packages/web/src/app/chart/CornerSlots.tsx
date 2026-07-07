'use client';
import type { ReactNode } from 'react';

/**
 * CornerSlots — anchors UI chrome to the four corners of the map cell using
 * the single `--s3` inset token from globals.css.  No hand-measured pixel
 * offsets anywhere; every slot stacks its children and they push each other
 * via flex gap rather than magic `top-[N]` values.
 *
 *   TL = top-left  → Follow toggle + Orientation cycle (ChartFollowControl)
 *   TR = top-right → Tool rail (AnnotationDropper, waypoint-drop toggle, etc.)
 *   BL = scale     → reserved for MapLibre's native ScaleControl; this slot is
 *                    a no-op placeholder that simply reserves the inset so
 *                    future content doesn't collide with the native control.
 *   BR = InspectPanel host (T5 fills content here).
 *
 * Each slot is absolutely positioned at its corner, offset by var(--s3).
 * Children stack vertically (column) within TL/TR/BL/BR, separated by 8px
 * gap — so adding a second child automatically pushes the first without any
 * additional positioning.
 *
 * OffscreenVesselIndicator is NOT a CornerSlot child — it is edge-anchored
 * (dynamically positioned to whichever edge is nearest the off-screen boat)
 * and stays separately positioned in page.tsx.
 */

interface CornerSlotsProps {
  /** Top-left children (Follow + Orientation). */
  tl?: ReactNode;
  /** Top-right children (tool rail). */
  tr?: ReactNode;
  /** Bottom-left children (scale area — usually empty; MapLibre native scale sits here). */
  bl?: ReactNode;
  /** Bottom-right children (InspectPanel host). */
  br?: ReactNode;
}

export function CornerSlots({ tl, tr, bl, br }: CornerSlotsProps) {
  return (
    <>
      {/* Top-left */}
      {tl && (
        <div
          className="absolute z-10 flex flex-col items-start gap-2"
          style={{ top: 'var(--s3)', left: 'var(--s3)' }}
        >
          {tl}
        </div>
      )}

      {/* Top-right */}
      {tr && (
        <div
          className="absolute z-10 flex flex-col items-end gap-2"
          style={{ top: 'var(--s3)', right: 'var(--s3)' }}
        >
          {tr}
        </div>
      )}

      {/* Bottom-left — reserved for native scale control; no-op when empty */}
      {bl && (
        <div
          className="absolute z-10 flex flex-col items-start gap-2"
          style={{ bottom: 'var(--s3)', left: 'var(--s3)' }}
        >
          {bl}
        </div>
      )}

      {/* Bottom-right — InspectPanel host (T5) */}
      {br && (
        <div
          className="absolute z-10 flex flex-col items-end gap-2"
          style={{ bottom: 'var(--s3)', right: 'var(--s3)' }}
        >
          {br}
        </div>
      )}
    </>
  );
}
