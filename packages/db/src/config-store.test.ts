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

describe('ConfigStore', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-cfg-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
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

    const reopened = await ConfigStore.open(path.join(dir, 'config.db'));
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

  it('returns the default polar on a fresh database', async () => {
    const polars = await firstValueFrom(store.polars$);
    expect(polars.twsBins).toEqual(DEFAULT_POLARS.twsBins);
    expect(polars.boatSpeed.length).toBe(DEFAULT_POLARS.twsBins.length);
  });

  it('emits a new polar when setPolars is called', async () => {
    const updated: PolarTable = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map(() => 0)),
    };
    await store.setPolars(updated);
    // In v2, setPolars writes a new revision and flips the active pointer.
    // The legacy polars$ alias is backed by activePolar$ (combineLatest of
    // sails + revisions), so the post-write current value is what we assert.
    const v = await firstValueFrom(store.polars$);
    expect(v.boatSpeed.flat().every((x) => x === 0)).toBe(true);
  });

  it('returns the default wardrobe on a fresh database', async () => {
    const w = await firstValueFrom(store.sails$);
    expect(w.activeConfigId).toBe('default');
    expect(w.configs).toHaveLength(1);
    expect(w.configs[0]!.id).toBe('default');
  });

  it('emits a new wardrobe when setSails is called', async () => {
    const next: Promise<SailWardrobe> = firstValueFrom(store.sails$.pipe(skip(1), take(1)));
    const updated: SailWardrobe = {
      ...DEFAULT_WARDROBE,
      configs: [
        ...DEFAULT_WARDROBE.configs,
        {
          id: 'reef1-a2',
          name: 'Reef 1 + A2',
          mainState: 'Reef 1',
          downwindSail: 'A2',
          polar: DEFAULT_WARDROBE.configs[0]!.polar,
        },
      ],
    };
    await store.setSails(updated);
    const v = await next;
    expect(v.configs).toHaveLength(2);
  });

  it('rejects setSails with an unknown activeConfigId', async () => {
    await expect(
      store.setSails({
        ...DEFAULT_WARDROBE,
        activeConfigId: 'does-not-exist',
      }),
    ).rejects.toThrow();
  });

  it('activePolar$ tracks the active config polar', async () => {
    const initial = await firstValueFrom(store.activePolar$);
    expect(initial.twsBins.length).toBeGreaterThan(0);

    // In v2: read the active slot's active revision via the resolver, then
    // create a distinct (all-zeros) revision under the same slot+mode and
    // flip the active pointer. activePolar$ should track the swap.
    const wardrobe = await firstValueFrom(store.sails$);
    const slot = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)!;
    const distinctPolar: PolarTable = {
      ...initial,
      boatSpeed: initial.boatSpeed.map((row) => row.map(() => 0)),
    };
    const newId = 'zeros-rev';
    await store.createRevision({
      id: newId,
      boatId: 'sula',
      sailConfigId: slot.id,
      mode: wardrobe.activeMode,
      parentRevisionId: slot.modes[wardrobe.activeMode]?.activeRevisionId ?? null,
      createdAt: Math.floor(Date.now() / 1000),
      lineage: { kind: 'manual_edit' },
      table: distinctPolar,
    });
    await store.setActiveRevision(slot.id, wardrobe.activeMode, newId);
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
    const reopened = await ConfigStore.open(path.join(dir, 'config.db'));
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
    const reopened = await ConfigStore.open(path.join(dir, 'config.db'));
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

  it('legacy polars$ tracks active config (backward compat)', async () => {
    // After Task 1, polars$ is an alias for activePolar$.
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

  describe('v1→v2 wardrobe migration', () => {
    it('seeds revision-0 from DEFAULT_POLARS on a fresh DB', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-fresh-${Date.now()}.db`;
      const store = await ConfigStore.open(tmp);
      const wardrobe = await firstValueFrom(store.sails$);
      expect(wardrobe.boatId).toBe('sula');
      expect(wardrobe.activeMode).toBe('default');
      const slot = wardrobe.configs[0]!;
      const revId = slot.modes.default?.activeRevisionId;
      expect(revId).toBeDefined();
      const rev = store.getRevision(revId!);
      expect(rev?.lineage.kind).toBe('migrated');
      expect(rev?.table).toEqual(DEFAULT_POLARS);
      await store.close();
    });

    it('migrates an existing v1 wardrobe row on cold boot', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-v1-${Date.now()}.db`;
      // Hand-craft a v1 wardrobe row first.
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(tmp);
      raw.exec(`
        CREATE TABLE polars (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sail_wardrobe (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      const v1 = {
        configs: [
          { id: 'default', name: 'Default', polar: DEFAULT_POLARS },
          { id: 'storm', name: 'Storm jib', polar: DEFAULT_POLARS },
        ],
        activeConfigId: 'storm',
      };
      raw
        .prepare('INSERT INTO sail_wardrobe (id, value) VALUES (?, ?)')
        .run('singleton', JSON.stringify(v1));
      raw.close();

      const store = await ConfigStore.open(tmp);
      const wardrobe = await firstValueFrom(store.sails$);
      expect(wardrobe.boatId).toBe('sula');
      expect(wardrobe.activeConfigId).toBe('storm');
      expect(wardrobe.configs).toHaveLength(2);
      for (const c of wardrobe.configs) {
        expect(c.modes.default?.activeRevisionId).toBeDefined();
        expect((c as Record<string, unknown>).polar).toBeUndefined();
      }
      await store.close();
    });

    it('is idempotent: a second open does not create new revisions', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-idem-${Date.now()}.db`;
      const a = await ConfigStore.open(tmp);
      const revsA = a.listRevisions();
      await a.close();
      const b = await ConfigStore.open(tmp);
      const revsB = b.listRevisions();
      expect(revsB.map((r) => r.id).sort()).toEqual(revsA.map((r) => r.id).sort());
      await b.close();
    });

    it('activePolar$ falls back to DEFAULT_POLARS when activeRevisionId is dangling', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-dangle-${Date.now()}.db`;
      const store = await ConfigStore.open(tmp);
      // Forge a wardrobe with a bad revisionId.
      const wardrobe = await firstValueFrom(store.sails$);
      const broken: SailWardrobe = {
        ...wardrobe,
        configs: [
          { ...wardrobe.configs[0]!, modes: { default: { activeRevisionId: 'doesnotexist' } } },
        ],
      };
      await store.setSails(broken);
      const polar = await firstValueFrom(store.activePolar$);
      expect(polar).toEqual(DEFAULT_POLARS);
      await store.close();
    });

    it('setActiveRevision swaps activePolar$ output within one tick', async () => {
      const tmp = `${tmpdir()}/g5000-cfg-swap-${Date.now()}.db`;
      const store = await ConfigStore.open(tmp);
      const wardrobe = await firstValueFrom(store.sails$);
      const slotId = wardrobe.configs[0]!.id;
      // Create a clearly distinct polar.
      const tweaked: PolarTable = {
        ...DEFAULT_POLARS,
        boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 1.5)),
      };
      const newId = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
      await store.createRevision({
        id: newId,
        boatId: 'sula',
        sailConfigId: slotId,
        mode: 'default',
        parentRevisionId: null,
        createdAt: Math.floor(Date.now() / 1000),
        lineage: { kind: 'manual_edit' },
        table: tweaked,
      });
      await store.setActiveRevision(slotId, 'default', newId);
      const polar = await firstValueFrom(store.activePolar$);
      expect(polar.boatSpeed[0]![1]).toBeCloseTo(DEFAULT_POLARS.boatSpeed[0]![1]! * 1.5);
      await store.close();
    });
  });
});
