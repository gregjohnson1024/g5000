import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  insertShipLogEntry,
  listShipLogEntries,
  deleteShipLogEntry,
  lastAutoEntryTsMs,
} from './ship-log.js';

describe('ShipLog', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-ship-log-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    const rows = await listShipLogEntries(store, { boatId: 'sula', limit: 10 });
    expect(rows).toEqual([]);
  });

  it('inserts and lists entries newest-first', async () => {
    const ts1 = 1_700_000_000_000;
    const ts2 = 1_700_000_060_000;
    await insertShipLogEntry(store, {
      tsMs: ts1,
      source: 'manual',
      kind: 'note',
      text: 'engine started',
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: ts2,
      source: 'auto',
      kind: 'position',
      lat: 41.5,
      lon: -71.3,
      cogDeg: 270,
      sogKn: 6.5,
      boatId: 'sula',
    });
    const rows = await listShipLogEntries(store, { boatId: 'sula', limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.tsMs).toBe(ts2);
    expect(rows[0]!.kind).toBe('position');
    expect(rows[1]!.text).toBe('engine started');
  });

  it('scopes by boatId', async () => {
    await insertShipLogEntry(store, {
      tsMs: 1,
      source: 'manual',
      kind: 'note',
      text: 'sula entry',
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: 2,
      source: 'manual',
      kind: 'note',
      text: 'other entry',
      boatId: 'other',
    });
    const sula = await listShipLogEntries(store, { boatId: 'sula', limit: 10 });
    expect(sula.map((r) => r.text)).toEqual(['sula entry']);
  });

  it('filters by source and kind', async () => {
    await insertShipLogEntry(store, {
      tsMs: 1,
      source: 'manual',
      kind: 'note',
      text: 'a',
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: 2,
      source: 'auto',
      kind: 'position',
      lat: 1,
      lon: 1,
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: 3,
      source: 'manual',
      kind: 'weather',
      text: 'squall',
      boatId: 'sula',
    });
    const manual = await listShipLogEntries(store, {
      boatId: 'sula',
      limit: 10,
      source: 'manual',
    });
    expect(manual.map((r) => r.text)).toEqual(['squall', 'a']);
    const weather = await listShipLogEntries(store, {
      boatId: 'sula',
      limit: 10,
      kind: 'weather',
    });
    expect(weather.map((r) => r.text)).toEqual(['squall']);
  });

  it('paginates with beforeMs', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await insertShipLogEntry(store, {
        tsMs: i * 1000,
        source: 'manual',
        kind: 'note',
        text: `entry ${i}`,
        boatId: 'sula',
      });
    }
    const page1 = await listShipLogEntries(store, { boatId: 'sula', limit: 2 });
    expect(page1.map((r) => r.text)).toEqual(['entry 5', 'entry 4']);
    const page2 = await listShipLogEntries(store, {
      boatId: 'sula',
      limit: 2,
      beforeMs: page1[1]!.tsMs,
    });
    expect(page2.map((r) => r.text)).toEqual(['entry 3', 'entry 2']);
  });

  it('substring search across text and author', async () => {
    await insertShipLogEntry(store, {
      tsMs: 1,
      source: 'manual',
      kind: 'note',
      text: 'changed jib',
      author: 'greg',
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: 2,
      source: 'manual',
      kind: 'note',
      text: 'oil check',
      author: 'kim',
      boatId: 'sula',
    });
    const jib = await listShipLogEntries(store, { boatId: 'sula', limit: 10, q: 'jib' });
    expect(jib.map((r) => r.text)).toEqual(['changed jib']);
    const byKim = await listShipLogEntries(store, { boatId: 'sula', limit: 10, q: 'kim' });
    expect(byKim.map((r) => r.text)).toEqual(['oil check']);
  });

  it('delete is scoped to boatId', async () => {
    const id = await insertShipLogEntry(store, {
      tsMs: 1,
      source: 'manual',
      kind: 'note',
      text: 'a',
      boatId: 'sula',
    });
    const wrongBoat = await deleteShipLogEntry(store, id, 'other');
    expect(wrongBoat).toBe(false);
    const right = await deleteShipLogEntry(store, id, 'sula');
    expect(right).toBe(true);
    const rows = await listShipLogEntries(store, { boatId: 'sula', limit: 10 });
    expect(rows).toEqual([]);
  });

  it('lastAutoEntryTsMs returns most recent auto row', async () => {
    expect(await lastAutoEntryTsMs(store, 'sula')).toBeNull();
    await insertShipLogEntry(store, {
      tsMs: 1000,
      source: 'manual',
      kind: 'note',
      text: 'a',
      boatId: 'sula',
    });
    expect(await lastAutoEntryTsMs(store, 'sula')).toBeNull();
    await insertShipLogEntry(store, {
      tsMs: 2000,
      source: 'auto',
      kind: 'position',
      lat: 1,
      lon: 1,
      boatId: 'sula',
    });
    await insertShipLogEntry(store, {
      tsMs: 3000,
      source: 'auto',
      kind: 'position',
      lat: 2,
      lon: 2,
      boatId: 'sula',
    });
    expect(await lastAutoEntryTsMs(store, 'sula')).toBe(3000);
  });
});
