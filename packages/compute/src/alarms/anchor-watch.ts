import { subscribeSelected, getSharedSourcePriority } from '@g5000/core';
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { haversineMeters, isBreached } from './anchor-geometry.js';

const ID = 'anchor-watch';

/** Seconds an unacked WARN breach persists before escalating to sticky CRITICAL. */
const DEFAULT_ESCALATE_AFTER_S = 30;

type Stage = { kind: 'idle' } | { kind: 'warn'; since: number } | { kind: 'critical' };

/**
 * Two-stage anchor-watch predicate.
 *
 * On breach (see isBreached: swing radius plus optional sector) it fires a
 * non-sticky WARN first — a nudge, not a siren. If the breach persists unacked
 * for `escalateAfterS`, it escalates to a sticky CRITICAL. Because
 * registry.fire() on an active-and-unacked alarm only refreshes it (severity
 * changes don't reopen a history row), escalation must clear() the WARN before
 * re-firing CRITICAL — that closes the WARN history row and opens a fresh one.
 * Acking the WARN suppresses escalation for the remainder of that breach.
 */
export function startAnchorWatchPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let stage: Stage = { kind: 'idle' };

  const unsubscribe = subscribeSelected(
    bus,
    'nav.gps.position',
    getSharedSourcePriority,
    (sample) => {
      const cfg = configRef.current;
      if (!cfg.enabled[ID]) return;
      const anchor = cfg.thresholds.anchor;
      const anchorPoint = anchor.anchorPoint ?? anchor.point;
      if (!anchor.armed || !anchorPoint) {
        // Weighed (or never armed): the /api route clears the registry; we
        // just reset the local escalation state so the next drop starts fresh.
        stage = { kind: 'idle' };
        return;
      }
      if (sample.value.kind !== 'geo') return;
      const pos = sample.value.value;

      const breached = isBreached(
        anchorPoint,
        anchor.radiusM,
        anchor.coneDeg,
        anchor.coneCenterDeg,
        pos,
      );
      if (!breached) {
        registry.clear(ID);
        stage = { kind: 'idle' };
        return;
      }

      const distance = haversineMeters(anchorPoint, pos);
      const label = `Anchor drag ${Math.round(distance)} m`;
      const context: Record<string, unknown> = {
        distanceM: Math.round(distance),
        position: pos,
      };
      const snapshot = registry.get(ID);
      const acked = snapshot !== undefined && snapshot.ackedAt !== null;

      switch (stage.kind) {
        case 'idle':
          registry.fire({ id: ID, severity: 'WARN', label, sticky: false, context });
          stage = { kind: 'warn', since: Date.now() };
          break;
        case 'warn': {
          if (acked) break; // user silenced the WARN — no escalation for this breach
          const escalateAfterS = anchor.escalateAfterS ?? DEFAULT_ESCALATE_AFTER_S;
          if (Date.now() - stage.since >= escalateAfterS * 1000) {
            // fire() no-ops the transition while active-and-unacked, so clear
            // first — the CRITICAL re-fire is then a fresh transition.
            registry.clear(ID);
            registry.fire({
              id: ID,
              severity: 'CRITICAL',
              label,
              sticky: true,
              context: { ...context, escalated: true },
            });
            stage = { kind: 'critical' };
          } else {
            // Refresh the live distance on the active WARN.
            registry.fire({ id: ID, severity: 'WARN', label, sticky: false, context });
          }
          break;
        }
        case 'critical':
          if (!acked) {
            registry.fire({
              id: ID,
              severity: 'CRITICAL',
              label,
              sticky: true,
              context: { ...context, escalated: true },
            });
          }
          break;
      }
    },
  );
  return { dispose: () => unsubscribe() };
}
