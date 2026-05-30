import { desc, eq } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { alarmsHistory } from './schema.js';

export interface AlarmHistoryRow {
  id: number;
  alarmId: string;
  severity: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context: Record<string, unknown> | null;
}

export interface AppendAlarmHistoryArgs {
  alarmId: string;
  severity: string;
  firedAt: string;
  context?: Record<string, unknown>;
}

// These helpers are intentionally SYNCHRONOUS. The drizzle better-sqlite3
// driver runs queries synchronously, so an `async` wrapper here was a no-op
// `await` over a non-Promise — and that fake async opened a real race: the
// fire-history writer set its dedup map inside a `.then()`, so a synchronous
// double-fire wrote a duplicate row. Keeping them sync lets callers update
// their bookkeeping in the same tick. Do NOT re-add `async` (see
// apps/g5000/src/alarms-history.ts and its test).
export function appendAlarmHistory(store: ConfigStore, args: AppendAlarmHistoryArgs): number {
  const db = store.drizzle;
  const result = db
    .insert(alarmsHistory)
    .values({
      alarmId: args.alarmId,
      severity: args.severity,
      firedAt: args.firedAt,
      context: args.context ? JSON.stringify(args.context) : null,
    })
    .returning({ id: alarmsHistory.id })
    .get();
  return result.id;
}

export function updateAlarmHistoryClear(
  store: ConfigStore,
  rowId: number,
  clearedAt: string,
): void {
  const db = store.drizzle;
  db.update(alarmsHistory).set({ clearedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export function updateAlarmHistoryAck(store: ConfigStore, rowId: number, ackedAt: string): void {
  const db = store.drizzle;
  db.update(alarmsHistory).set({ ackedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export function listAlarmHistory(
  store: ConfigStore,
  opts: { limit: number; before?: string },
): AlarmHistoryRow[] {
  const db = store.drizzle;
  const rows = db
    .select()
    .from(alarmsHistory)
    .orderBy(desc(alarmsHistory.firedAt))
    .limit(opts.limit)
    .all();
  return rows.map((r) => ({
    id: r.id,
    alarmId: r.alarmId,
    severity: r.severity,
    firedAt: r.firedAt,
    clearedAt: r.clearedAt,
    ackedAt: r.ackedAt,
    context: r.context ? (JSON.parse(r.context) as Record<string, unknown>) : null,
  }));
}
