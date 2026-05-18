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

export async function appendAlarmHistory(
  store: ConfigStore,
  args: AppendAlarmHistoryArgs,
): Promise<number> {
  const db = store.drizzle;
  const result = await db
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

export async function updateAlarmHistoryClear(
  store: ConfigStore,
  rowId: number,
  clearedAt: string,
): Promise<void> {
  const db = store.drizzle;
  await db.update(alarmsHistory).set({ clearedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export async function updateAlarmHistoryAck(
  store: ConfigStore,
  rowId: number,
  ackedAt: string,
): Promise<void> {
  const db = store.drizzle;
  await db.update(alarmsHistory).set({ ackedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export async function listAlarmHistory(
  store: ConfigStore,
  opts: { limit: number; before?: string },
): Promise<AlarmHistoryRow[]> {
  const db = store.drizzle;
  const rows = await db
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
