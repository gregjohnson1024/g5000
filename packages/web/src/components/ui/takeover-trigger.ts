/**
 * takeover-trigger — pure, side-effect-free logic for picking the Takeover alarm.
 *
 * Only CRITICAL alarms with ids in the Takeover set ({mob, anchor-watch}) qualify.
 * When multiple qualify, the one with the highest SEVERITY_RANK wins; ties are
 * broken by the order they appear in the (already severity-sorted) active array,
 * so the caller's sort order is respected.
 */

import type { AlarmRow } from '../AlarmStore';

/** The set of alarm ids that escalate to full-viewport Takeover. */
const TAKEOVER_IDS = new Set(['mob', 'anchor-watch']);

/**
 * pickCriticalTakeover — return the highest-ranked active alarm that deserves a Takeover,
 * or null if no alarm qualifies.
 *
 * @param active - The severity-sorted active alarm list from useAlarms().
 *   Must already be sorted highest-severity first (AlarmStore guarantees this).
 * @returns The first matching AlarmRow (CRITICAL severity + id in TAKEOVER_IDS), or null.
 */
export function pickCriticalTakeover(active: AlarmRow[]): AlarmRow | null {
  for (const row of active) {
    if (row.severity === 'CRITICAL' && TAKEOVER_IDS.has(row.id)) {
      return row;
    }
  }
  return null;
}
