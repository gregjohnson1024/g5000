import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom, take, skip } from 'rxjs';
import { ConfigStore } from './config-store.js';
import {
  DEFAULT_AIS_ALARM_CONFIG,
  DEFAULT_BOAT_CONFIG,
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_DAMPING_CONFIG,
  DEFAULT_POLARS,
  DEFAULT_SOURCE_PRIORITY,
  DEFAULT_WARDROBE,
  type AisAlarmConfig,
  type BoatConfig,
  type DampingConfig,
  type PolarTable,
  type SailWardrobe,
  type SourcePriorityConfig,
} from './defaults.js';
import type { Waypoint, Route } from './waypoints-routes-types.js';
import type { BoatState } from './boat-state.js';

describe('ConfigStore', () => {
  let dir: string;
  let dbPath: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-cfg-'));
    dbPath = path.join(dir, 'config.db');
    store = await ConfigStore.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns identity defaults on a fresh database', async () => {
    const cfg = await firstValueFrom(store.boatConfig$);
    expect(cfg).toEqual(DEFAULT_BOAT_CONFIG);
    const cal = await firstValueFrom(store.awsAwaCal$);
    expect(cal.awsBins).toEqual(DEFAULT_AWS_AWA_CAL.awsBins);
    expect(cal.angleCorrection.flat().every((v) => v === 0)).toBe(true);
  });

  it('emits the new value on the observable when setBoatConfig is called', async () => {
    const next: Promise<BoatConfig> = firstValueFrom(store.boatConfig$.pipe(skip(1), take(1)));
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: -15.3 });
    const v = await next;
    expect(v.magVarDeg).toBe(-15.3);
  });

  it('persists writes across reopens', async () => {
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: -12 });
    await store.close();

    const reopened = await ConfigStore.open(dbPath);
    const cfg = await firstValueFrom(reopened.boatConfig$);
    expect(cfg.magVarDeg).toBe(-12);
    await reopened.close();
    // re-assign so afterEach close() doesn't re-close the original
    store = reopened;
  });

  it('exposes BehaviorSubject-like access — late subscribers get the current value', async () => {
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: 5 });
    const v = await firstValueFrom(store.boatConfig$);
    expect(v.magVarDeg).toBe(5);
  });

  it('returns DEFAULT_POLARS via activePolar$ on a fresh database', async () => {
    // v3: no revisions yet means activePolar$ falls back to DEFAULT_POLARS.
    const polars = await firstValueFrom(store.activePolar$);
    expect(polars.twsBins).toEqual(DEFAULT_POLARS.twsBins);
    expect(polars.boatSpeed.length).toBe(DEFAULT_POLARS.twsBins.length);
  });

  it('returns the default (empty) wardrobe on a fresh database', async () => {
    const w = await firstValueFrom(store.sails$);
    expect(w.schemaVersion).toBe(3);
    expect(w.boatId).toBe('sula');
    expect(w.sails).toEqual([]);
    expect(w.active).toEqual({});
    expect(w.activeMode).toBe('default');
  });

  it('emits a new wardrobe when setSails is called', async () => {
    const next: Promise<SailWardrobe> = firstValueFrom(store.sails$.pipe(skip(1), take(1)));
    const updated: SailWardrobe = {
      ...DEFAULT_WARDROBE,
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
        { id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } },
      ],
      active: { headsail: 'j0', main: 'reef1' },
    };
    await store.setSails(updated);
    const v = await next;
    expect(v.sails).toHaveLength(2);
    expect(v.active.headsail).toBe('j0');
  });

  it('activePolar$ tracks the newest revision for (boatId, activeMode)', async () => {
    // No revisions yet — activePolar$ falls back to DEFAULT_POLARS.
    const initial = await firstValueFrom(store.activePolar$);
    expect(initial.twsBins.length).toBeGreaterThan(0);

    // Create a distinct (all-zeros) revision for the active boat+mode. Because
    // it's the newest revision for (sula, default), activePolar$ must emit it.
    const wardrobe = await firstValueFrom(store.sails$);
    const distinctPolar: PolarTable = {
      ...initial,
      boatSpeed: initial.boatSpeed.map((row) => row.map(() => 0)),
    };
    const newId = 'zeros-rev';
    await store.createRevision({
      id: newId,
      boatId: 'sula',
      // v3: sail_config_id has no wardrobe meaning anymore, but the polar_revisions
      // schema still requires it (free-form provenance label).
      sailConfigId: 'manual',
      mode: wardrobe.activeMode,
      parentRevisionId: null,
      createdAt: Math.floor(Date.now() / 1000),
      lineage: { kind: 'manual_edit' },
      table: distinctPolar,
    });
    const after = await firstValueFrom(store.activePolar$);
    expect(after.boatSpeed.flat().every((x) => x === 0)).toBe(true);
  });

  it('returns the default damping config (empty) on a fresh database', async () => {
    const c = await firstValueFrom(store.dampingConfig$);
    expect(c).toEqual(DEFAULT_DAMPING_CONFIG);
    expect(Object.keys(c)).toHaveLength(0);
    expect(store.getDampingConfig()).toEqual({});
  });

  it('persists damping config across reopens', async () => {
    await store.setDampingConfig({ 'boat.speed.water': 2.5, 'wind.true.speed': 3.0 });
    await store.close();
    const reopened = await ConfigStore.open(dbPath);
    const c = await firstValueFrom(reopened.dampingConfig$);
    expect(c).toEqual({ 'boat.speed.water': 2.5, 'wind.true.speed': 3.0 });
    await reopened.close();
    store = reopened;
  });

  it('strips zero / negative / non-finite tau values on setDampingConfig', async () => {
    const next: Promise<DampingConfig> = firstValueFrom(
      store.dampingConfig$.pipe(skip(1), take(1)),
    );
    await store.setDampingConfig({
      'boat.speed.water': 2.0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'should.strip.zero': 0 as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'should.strip.negative': -1 as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'should.strip.nan': NaN as any,
    });
    const v = await next;
    expect(Object.keys(v).sort()).toEqual(['boat.speed.water']);
    expect(v['boat.speed.water']).toBe(2.0);
  });

  it('returns the default source-priority config (empty array) on a fresh database', async () => {
    const c = await firstValueFrom(store.sourcePriority$);
    expect(c).toEqual(DEFAULT_SOURCE_PRIORITY);
    expect(Array.isArray(c)).toBe(true);
    expect(c).toHaveLength(0);
    expect(store.getSourcePriority()).toEqual([]);
  });

  it('persists source-priority config across reopens', async () => {
    const cfg: SourcePriorityConfig = [
      {
        channelPattern: 'wind.apparent.angle',
        sources: ['n2k:127250@dev0x10', 'demo'],
        freshnessSeconds: 2,
      },
    ];
    await store.setSourcePriority(cfg);
    await store.close();
    const reopened = await ConfigStore.open(dbPath);
    const c = await firstValueFrom(reopened.sourcePriority$);
    expect(c).toEqual(cfg);
    await reopened.close();
    store = reopened;
  });

  it('strips invalid source-priority rules on setSourcePriority', async () => {
    const next: Promise<SourcePriorityConfig> = firstValueFrom(
      store.sourcePriority$.pipe(skip(1), take(1)),
    );
    await store.setSourcePriority([
      // Valid.
      { channelPattern: 'wind.apparent.angle', sources: ['demo'], freshnessSeconds: 2 },
      // Empty sources → dropped.
      { channelPattern: 'wind.true.speed', sources: [], freshnessSeconds: 2 },
      // Negative freshness → dropped.
      { channelPattern: 'boat.speed.water', sources: ['demo'], freshnessSeconds: -1 },
      // Missing channelPattern → dropped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { channelPattern: '', sources: ['demo'], freshnessSeconds: 2 } as any,
    ]);
    const v = await next;
    expect(v).toHaveLength(1);
    expect(v[0]!.channelPattern).toBe('wind.apparent.angle');
  });

  it('legacy polars$ alias tracks activePolar$ (backward compat)', async () => {
    // polars$ is still exported as an alias for activePolar$.
    const a = await firstValueFrom(store.polars$);
    const b = await firstValueFrom(store.activePolar$);
    expect(a).toEqual(b);
  });

  it('returns DEFAULT_AIS_ALARM_CONFIG on a fresh database', async () => {
    const c = await firstValueFrom(store.aisAlarmConfig$);
    expect(c).toEqual(DEFAULT_AIS_ALARM_CONFIG);
  });

  it('persists AIS alarm config writes and emits on the observable', async () => {
    const next: Promise<AisAlarmConfig> = firstValueFrom(
      store.aisAlarmConfig$.pipe(skip(1), take(1)),
    );
    await store.setAisAlarmConfig({ enabled: false, cpaMeters: 500, tcpaSeconds: 120 });
    const v = await next;
    expect(v).toEqual({ enabled: false, cpaMeters: 500, tcpaSeconds: 120 });
    // Synchronous read also returns the new value.
    expect(store.getAisAlarmConfig()).toEqual({
      enabled: false,
      cpaMeters: 500,
      tcpaSeconds: 120,
    });
  });

  it('rejects invalid AIS alarm config', async () => {
    await expect(
      store.setAisAlarmConfig({ enabled: true, cpaMeters: -1, tcpaSeconds: 60 }),
    ).rejects.toThrow(/cpaMeters/);
    await expect(
      store.setAisAlarmConfig({ enabled: true, cpaMeters: 100, tcpaSeconds: 0 }),
    ).rejects.toThrow(/tcpaSeconds/);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.setAisAlarmConfig({ enabled: 'no' as any, cpaMeters: 100, tcpaSeconds: 60 }),
    ).rejects.toThrow(/enabled/);
  });

  describe('v2 → v3 wardrobe migration on open', () => {
    it('seeds an empty v3 wardrobe on a fresh DB', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-fresh-${Date.now()}.db`;
      const store = await ConfigStore.open(tmp);
      const wardrobe = await firstValueFrom(store.sails$);
      expect(wardrobe.schemaVersion).toBe(3);
      expect(wardrobe.boatId).toBe('sula');
      expect(wardrobe.activeMode).toBe('default');
      expect(wardrobe.sails).toEqual([]);
      expect(wardrobe.active).toEqual({});
      await store.close();
    });

    it('migrates an existing v2 wardrobe row on cold boot', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-v2-${Date.now()}.db`;
      // Hand-craft a v2 wardrobe row before any ConfigStore touches the DB.
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(tmp);
      raw.exec(`
        CREATE TABLE sail_wardrobe (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      const v2 = {
        boatId: 'sula',
        configs: [
          { id: 'j0-full', name: 'J0 + Full', headsail: 'J0', mainState: 'Full', modes: {} },
          { id: 'j0-reef1', name: 'J0 + Reef1', headsail: 'J0', mainState: 'Reef1', modes: {} },
        ],
        activeConfigId: 'j0-full',
        activeMode: 'default',
      };
      raw
        .prepare('INSERT INTO sail_wardrobe (id, value) VALUES (?, ?)')
        .run('singleton', JSON.stringify(v2));
      raw.close();

      const store = await ConfigStore.open(tmp);
      const wardrobe = await firstValueFrom(store.sails$);
      expect(wardrobe.schemaVersion).toBe(3);
      expect(wardrobe.boatId).toBe('sula');
      // Sails are atomic now — J0 (headsail), Full Main + Reef1 (main).
      const ids = wardrobe.sails.map((s) => s.id).sort();
      expect(ids).toEqual(['full-main', 'j0', 'reef1']);
      // Active pointer is derived from the v2 activeConfigId (j0-full).
      expect(wardrobe.active).toEqual({ headsail: 'j0', main: 'full-main' });
      await store.close();
    });

    it('is idempotent: a second open does not rewrite the wardrobe', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-idem-${Date.now()}.db`;
      const a = await ConfigStore.open(tmp);
      const wa = await firstValueFrom(a.sails$);
      await a.close();
      const b = await ConfigStore.open(tmp);
      const wb = await firstValueFrom(b.sails$);
      expect(wb).toEqual(wa);
      await b.close();
    });

    it('drops the legacy crossover_map table after migration', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-xm-drop-${Date.now()}.db`;
      const store = await ConfigStore.open(tmp);
      await store.close();
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(tmp);
      const rows = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crossover_map'")
        .all() as Array<{ name: string }>;
      expect(rows).toEqual([]);
      raw.close();
    });

    it('transaction primitive used internally rolls back atomically on throw', async () => {
      // Generic property of the better-sqlite3 transaction primitive — keeps
      // confidence that any future migration code using raw.transaction(fn)
      // gets atomic rollback semantics.
      const tmp = `${tmpdir()}/g5000-cfg-tx-${Date.now()}.db`;
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(tmp);
      raw.exec(`CREATE TABLE tx_demo (id TEXT PRIMARY KEY, x TEXT)`);
      const fn = raw.transaction((shouldFail: boolean) => {
        raw.prepare('INSERT INTO tx_demo (id, x) VALUES (?, ?)').run('a', 'one');
        raw.prepare('INSERT INTO tx_demo (id, x) VALUES (?, ?)').run('b', 'two');
        if (shouldFail) throw new Error('simulated mid-tx failure');
      });
      expect(() => fn(true)).toThrow(/simulated mid-tx failure/);
      const rows = raw.prepare('SELECT COUNT(*) as n FROM tx_demo').get() as { n: number };
      expect(rows.n).toBe(0);
      // Sanity: the same transaction without a throw commits both rows.
      fn(false);
      const after = raw.prepare('SELECT COUNT(*) as n FROM tx_demo').get() as { n: number };
      expect(after.n).toBe(2);
      raw.close();
    });
  });

  describe('ConfigStore waypoints + routes', () => {
    it('defaults to empty lists', async () => {
      expect(store.getWaypoints()).toEqual([]);
      expect(store.getRoutes()).toEqual([]);
    });

    it('round-trips waypoints', async () => {
      const wps: Waypoint[] = [
        { id: 'a', name: 'A', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
      ];
      await store.setWaypoints(wps);
      expect(store.getWaypoints()).toEqual(wps);
      expect(await firstValueFrom(store.waypoints$)).toEqual(wps);
    });

    it('round-trips routes', async () => {
      const rts: Route[] = [
        {
          id: 'r1',
          name: 'R1',
          waypointIds: ['a', 'b'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      await store.setRoutes(rts);
      expect(store.getRoutes()).toEqual(rts);
      expect(await firstValueFrom(store.routes$)).toEqual(rts);
    });

    it('persists across reopen', async () => {
      await store.setWaypoints([
        { id: 'x', name: 'X', lat: 0, lon: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      ]);
      await store.close();
      store = await ConfigStore.open(dbPath);
      expect(store.getWaypoints().map((w) => w.id)).toEqual(['x']);
    });
  });

  describe('ConfigStore boat_state', () => {
    it('defaults to boards up + engines stopped', () => {
      expect(store.getBoatState()).toEqual({
        daggerboards: { port: 0, starboard: 0 },
        engines: { port: { running: false }, starboard: { running: false } },
      });
    });
    it('round-trips a boat state', async () => {
      const s: BoatState = {
        daggerboards: { port: 75, starboard: 50 },
        engines: { port: { running: true }, starboard: { running: false } },
      };
      await store.setBoatState(s);
      expect(store.getBoatState()).toEqual(s);
      expect(await firstValueFrom(store.boatState$)).toEqual(s);
    });
    it('persists across reopen', async () => {
      await store.setBoatState({
        daggerboards: { port: 25, starboard: 100 },
        engines: { port: { running: false }, starboard: { running: true } },
      });
      await store.close();
      store = await ConfigStore.open(dbPath);
      expect(store.getBoatState().daggerboards.starboard).toBe(100);
    });
  });
});
