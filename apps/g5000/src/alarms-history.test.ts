import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, listAlarmHistory } from '@g5000/db';
import { createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { wireAlarmsHistory } from './alarms-history.js';

/**
 * The history writer used to `.set()` the per-alarm row-id map inside an async
 * `.then()`, so a synchronous double-fire bypassed the "already recorded?"
 * guard and wrote a duplicate row (and lost the row mapping for the subsequent
 * clear/ack). On a safety surface — depth oscillating across the shallow-water
 * threshold while crossing a shoal — that corrupts the post-incident history.
 * These tests pin the synchronous path.
 */
describe('wireAlarmsHistory — synchronous fire/clear bookkeeping', () => {
  let dir: string;
  let store: ConfigStore;
  let registry: AlarmsRegistry;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-alarms-wire-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
    registry = createAlarmsRegistry();
    wireAlarmsHistory({ store, registry });
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const fireShallow = (): void =>
    registry.fire({
      id: 'shallow-water',
      severity: 'CRITICAL',
      label: 'Shallow water',
      sticky: false,
      context: { depth: 1.8 },
    });

  it('records exactly one history row for a synchronous double-fire', async () => {
    fireShallow();
    fireShallow(); // same tick — before any async insert could have resolved
    await settle();
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toHaveLength(1);
  });

  it('a synchronous fire→clear→fire cycle records two rows, exactly one cleared', async () => {
    fireShallow();
    registry.clear('shallow-water'); // non-sticky: closes the row and drops the mapping
    fireShallow(); // a fresh activation → a fresh row
    await settle();
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toHaveLength(2);
    // Order-independent: the first activation was cleared, the second still open.
    expect(rows.filter((r) => r.clearedAt !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.clearedAt === null)).toHaveLength(1);
  });
});

/**
 * Let any (buggy) pending async inserts flush before asserting, so the count
 * reflects what actually landed rather than racing the microtask queue.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}
