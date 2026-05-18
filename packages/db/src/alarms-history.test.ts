import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  appendAlarmHistory,
  listAlarmHistory,
  updateAlarmHistoryClear,
  updateAlarmHistoryAck,
} from './alarms-history.js';

describe('AlarmsHistory', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-alarms-hist-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toEqual([]);
  });

  it('appends rows and lists them newest-first', async () => {
    const id1 = await appendAlarmHistory(store, {
      alarmId: 'shallow-water',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
      context: { depth: 1.8 },
    });
    const id2 = await appendAlarmHistory(store, {
      alarmId: 'over-speed',
      severity: 'WARN',
      firedAt: '2026-05-18T12:05:00Z',
    });

    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(id2);
    expect(rows[0]?.alarmId).toBe('over-speed');
    expect(rows[1]?.alarmId).toBe('shallow-water');
    expect(rows[1]?.context).toEqual({ depth: 1.8 });
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAlarmHistory(store, {
        alarmId: 'over-speed',
        severity: 'WARN',
        firedAt: `2026-05-18T12:0${i}:00Z`,
      });
    }
    const rows = await listAlarmHistory(store, { limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('updateAlarmHistoryClear sets clearedAt on a row', async () => {
    const id = await appendAlarmHistory(store, {
      alarmId: 'shallow-water',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
    });
    await updateAlarmHistoryClear(store, id, '2026-05-18T12:01:00Z');
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows[0]?.clearedAt).toBe('2026-05-18T12:01:00Z');
  });

  it('updateAlarmHistoryAck sets ackedAt on a row', async () => {
    const id = await appendAlarmHistory(store, {
      alarmId: 'mob',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
    });
    await updateAlarmHistoryAck(store, id, '2026-05-18T12:02:00Z');
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows[0]?.ackedAt).toBe('2026-05-18T12:02:00Z');
  });
});
