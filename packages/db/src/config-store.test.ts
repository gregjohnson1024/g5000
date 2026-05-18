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
  DEFAULT_WARDROBE_SETTINGS,
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
    const next: Promise<PolarTable> = firstValueFrom(store.polars$.pipe(skip(1), take(1)));
    const updated: PolarTable = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map(() => 0)),
    };
    await store.setPolars(updated);
    const v = await next;
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

    // Add a config with a distinct polar (all zeros) and switch to it.
    const wardrobe = await firstValueFrom(store.sails$);
    const distinctPolar = {
      ...wardrobe.configs[0]!.polar,
      boatSpeed: wardrobe.configs[0]!.polar.boatSpeed.map((row) => row.map(() => 0)),
    };
    await store.setSails({
      configs: [...wardrobe.configs, { id: 'zeros', name: 'Zeros', polar: distinctPolar }],
      activeConfigId: 'zeros',
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
});

describe('ConfigStore.wardrobeSettings$', () => {
  it('emits defaults when the wardrobe has no settings field', async () => {
    const store = await ConfigStore.open(':memory:');
    const got = await firstValueFrom(store.wardrobeSettings$);
    expect(got).toEqual(DEFAULT_WARDROBE_SETTINGS);
    await store.close();
  });

  it('emits merged settings when partial settings are persisted', async () => {
    const store = await ConfigStore.open(':memory:');
    const w = await firstValueFrom(store.sails$);
    await store.setSails({
      ...w,
      settings: { ...DEFAULT_WARDROBE_SETTINGS, hysteresisPercent: 10 },
    });
    const got = await firstValueFrom(store.wardrobeSettings$);
    expect(got.hysteresisPercent).toBe(10);
    expect(got.chartTwsMaxKn).toBe(DEFAULT_WARDROBE_SETTINGS.chartTwsMaxKn);
    await store.close();
  });
});
