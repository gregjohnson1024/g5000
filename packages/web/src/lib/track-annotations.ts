/**
 * Track annotation types + pure helpers. Lives in its own file so client
 * components can import them without pulling in lib/tracks.ts (which uses
 * node:fs for the on-disk track storage and is server-only).
 */

export interface TrackAnnotation {
  /** Unix ms when the marker was dropped. Server-assigned at append time. */
  tsMs: number;
  /** Display label — pre-set ("J3", "Tack") or custom free text. */
  label: string;
  /** Discriminator. `event` = single moment; `periodStart` / `periodEnd`
   * come in pairs and define a croppable range. */
  kind: 'event' | 'periodStart' | 'periodEnd';
}

/**
 * Return the most recent `periodStart` in `annotations` that is NOT
 * followed by a `periodEnd`. Returns null when no period is open.
 *
 * Pure; callers pass annotations in insertion order (we don't re-sort).
 */
export function openPeriodStart(annotations: TrackAnnotation[]): TrackAnnotation | null {
  let open: TrackAnnotation | null = null;
  for (const a of annotations) {
    if (a.kind === 'periodStart') open = a;
    else if (a.kind === 'periodEnd') open = null;
  }
  return open;
}
