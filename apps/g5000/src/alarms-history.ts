import type { AlarmsRegistry } from '@g5000/core';
import {
  type ConfigStore,
  appendAlarmHistory,
  updateAlarmHistoryClear,
  updateAlarmHistoryAck,
} from '@g5000/db';

/**
 * Wrap the registry mutators so each fire/clear/ack transition also appends to
 * the alarms_history table. Persistence is best-effort: a DB hiccup must
 * NEVER fail the alarm itself, so the .then/.catch chains swallow errors.
 * rowIdByAlarmId tracks the current history row per alarm id; cleared on
 * ack so a re-fire opens a fresh row.
 *
 * Kept in the app (NOT pushed into @g5000/db) — it stitches a core registry to
 * a db table, which is an app-level concern.
 */
export function wireAlarmsHistory(deps: { store: ConfigStore; registry: AlarmsRegistry }): void {
  const { store, registry: alarmsRegistry } = deps;
  const rowIdByAlarmId = new Map<string, number>();

  const rawFire = alarmsRegistry.fire.bind(alarmsRegistry);
  alarmsRegistry.fire = (req) => {
    rawFire(req);
    // Only append a history row on a fresh fire (no current active entry).
    const snapshot = alarmsRegistry.get(req.id);
    if (snapshot && !rowIdByAlarmId.has(req.id)) {
      appendAlarmHistory(store, {
        alarmId: req.id,
        severity: req.severity,
        firedAt: snapshot.firedAt,
        context: snapshot.context as Record<string, unknown> | undefined,
      })
        .then((rowId) => rowIdByAlarmId.set(req.id, rowId))
        .catch(() => {
          /* don't fail the alarm on a DB hiccup */
        });
    }
  };

  const rawClear = alarmsRegistry.clear.bind(alarmsRegistry);
  alarmsRegistry.clear = (id) => {
    rawClear(id);
    const rowId = rowIdByAlarmId.get(id);
    if (rowId !== undefined) {
      updateAlarmHistoryClear(store, rowId, new Date().toISOString()).catch(() => {});
      // For non-sticky alarms, re-fires should open a NEW history row, so drop
      // the mapping here. For sticky alarms (mob, anchor-watch), the alarm
      // stays active until ack — the ack wrapper still needs the rowId to
      // close out ackedAt, so we leave the mapping intact until ack.
      const snapshot = alarmsRegistry.get(id);
      if (snapshot && !snapshot.sticky) {
        rowIdByAlarmId.delete(id);
      }
    }
  };

  const rawAck = alarmsRegistry.ack.bind(alarmsRegistry);
  alarmsRegistry.ack = (id) => {
    rawAck(id);
    const rowId = rowIdByAlarmId.get(id);
    if (rowId !== undefined) {
      updateAlarmHistoryAck(store, rowId, new Date().toISOString()).catch(() => {});
      rowIdByAlarmId.delete(id);
    }
  };
}
