/**
 * G5000-derived safety alarms registry.
 *
 * Parallel to the N2K-derived AlertsRegistry in alerts.ts. This one
 * tracks alarms synthesized by g5000 itself (anchor watch, MOB, etc.) —
 * compute predicates fire/clear, the UI reads.
 *
 * Persistence is the caller's responsibility (see packages/db/src/alarms-history.ts);
 * this registry is in-memory state for the active set plus a short recent history.
 */

export type AlarmSeverity = 'CRITICAL' | 'WARN' | 'INFO';

export interface AlarmSnapshot {
  /** Stable identifier: 'mob' | 'anchor-watch' | 'shallow-water' | 'over-speed' | 'low-battery'. */
  id: string;
  severity: AlarmSeverity;
  /** Human-readable label for UI. */
  label: string;
  /** True if alarm stays in active list after condition clears. */
  sticky: boolean;
  /** ISO timestamp of most-recent fire transition. */
  firedAt: string;
  /** ISO timestamp when the underlying condition cleared (null if still active). */
  clearedAt: string | null;
  /** ISO timestamp when the user acknowledged (null if unacked). */
  ackedAt: string | null;
  /** Free-form context captured at fire time (e.g. position, sample value). */
  context?: Record<string, unknown>;
}

export interface AlarmFireRequest {
  id: string;
  severity: AlarmSeverity;
  label: string;
  sticky: boolean;
  context?: Record<string, unknown>;
}

export interface AlarmsRegistry {
  /** All known alarms (active + recently cleared/acked). */
  all(): AlarmSnapshot[];
  /** Active alarms: unacked AND (not cleared OR sticky). */
  active(): AlarmSnapshot[];
  /** Lookup by id. */
  get(id: string): AlarmSnapshot | undefined;
  /** Fire an alarm. If already active, refreshes firedAt and merges context. */
  fire(req: AlarmFireRequest): void;
  /** Mark the underlying condition as cleared. Non-sticky alarms become inactive immediately. */
  clear(id: string): void;
  /** User acknowledgement. Removes from active regardless of sticky/clear state. */
  ack(id: string): void;
  /** Drop everything (tests only). */
  reset(): void;
}

export function createAlarmsRegistry(): AlarmsRegistry {
  const byId = new Map<string, AlarmSnapshot>();

  function isActive(a: AlarmSnapshot): boolean {
    if (a.ackedAt !== null) return false;
    if (a.clearedAt === null) return true;
    return a.sticky;
  }

  return {
    all: () => Array.from(byId.values()).sort((x, y) => y.firedAt.localeCompare(x.firedAt)),
    active: () =>
      Array.from(byId.values())
        .filter(isActive)
        .sort((x, y) => y.firedAt.localeCompare(x.firedAt)),
    get: (id) => byId.get(id),
    fire: (req) => {
      const now = new Date().toISOString();
      const prev = byId.get(req.id);
      const merged: AlarmSnapshot = {
        id: req.id,
        severity: req.severity,
        label: req.label,
        sticky: req.sticky,
        firedAt: prev && prev.ackedAt === null && prev.clearedAt === null ? prev.firedAt : now,
        clearedAt: null,
        ackedAt: null,
        context: { ...(prev?.context ?? {}), ...(req.context ?? {}) },
      };
      byId.set(req.id, merged);
    },
    clear: (id) => {
      const prev = byId.get(id);
      if (!prev) return;
      if (prev.clearedAt !== null) return;
      byId.set(id, { ...prev, clearedAt: new Date().toISOString() });
    },
    ack: (id) => {
      const prev = byId.get(id);
      if (!prev) return;
      byId.set(id, { ...prev, ackedAt: new Date().toISOString() });
    },
    reset: () => byId.clear(),
  };
}

declare const globalThis: { __g5000_alarms__?: AlarmsRegistry };

export function getSharedAlarms(): AlarmsRegistry | undefined {
  return globalThis.__g5000_alarms__;
}

export function setSharedAlarms(r: AlarmsRegistry): void {
  globalThis.__g5000_alarms__ = r;
}

export function _resetAlarmsForTests(): void {
  globalThis.__g5000_alarms__ = undefined;
}
