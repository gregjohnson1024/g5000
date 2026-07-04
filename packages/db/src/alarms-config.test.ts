import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  loadAlarmsConfig,
  saveAlarmsConfig,
  isAlarmsConfig,
  DEFAULT_ALARMS_CONFIG,
  type AlarmsConfig,
} from './alarms-config.js';

describe('AlarmsConfig persistence', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-alarms-cfg-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns DEFAULT_ALARMS_CONFIG on a fresh database', async () => {
    const cfg = await loadAlarmsConfig(store);
    expect(cfg).toEqual(DEFAULT_ALARMS_CONFIG);
    expect(cfg.enabled.mob).toBe(true);
    expect(cfg.thresholds.shallowWater.thresholdM).toBeGreaterThan(0);
  });

  it('persists writes across reopens', async () => {
    const next: AlarmsConfig = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, 'over-speed': false },
      thresholds: {
        ...DEFAULT_ALARMS_CONFIG.thresholds,
        anchor: {
          armed: true,
          point: { lat: 32.3, lon: -64.8 },
          droppedAt: '2026-05-18T12:00:00Z',
          radiusM: 75,
        },
      },
    };
    await saveAlarmsConfig(store, next);

    await store.close();
    store = await ConfigStore.open(join(dir, 'cfg.db'));
    const reloaded = await loadAlarmsConfig(store);
    expect(reloaded.enabled['over-speed']).toBe(false);
    expect(reloaded.thresholds.anchor.armed).toBe(true);
    expect(reloaded.thresholds.anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    expect(reloaded.thresholds.anchor.radiusM).toBe(75);
  });

  it('returns defaults for unknown alarm ids in enabled map', async () => {
    const cfg = await loadAlarmsConfig(store);
    // All 5 v1 alarm ids must default to enabled
    for (const id of ['mob', 'anchor-watch', 'shallow-water', 'over-speed', 'low-battery']) {
      expect(cfg.enabled[id]).toBe(true);
    }
    // high-wind is opt-in (demo wind would false-alarm)
    expect(cfg.enabled['high-wind']).toBe(false);
  });

  it('backfills thresholds and push for a pre-existing row missing the new keys', async () => {
    // Simulate a config.db row written before highWind/push existed.
    const legacy = structuredClone(DEFAULT_ALARMS_CONFIG) as Record<string, unknown>;
    delete (legacy.thresholds as Record<string, unknown>).highWind;
    delete legacy.push;
    (legacy.enabled as Record<string, boolean>)['over-speed'] = false; // a stored value that must survive
    await saveAlarmsConfig(store, legacy as unknown as AlarmsConfig);

    const cfg = await loadAlarmsConfig(store);
    expect(cfg.thresholds.highWind).toEqual({ thresholdKn: 30, holdMs: 60000 });
    expect(cfg.push).toEqual({ ntfyTopic: null, ntfyUrl: null });
    expect(cfg.enabled['high-wind']).toBe(false);
    expect(cfg.enabled['over-speed']).toBe(false); // stored still wins
  });

  it('stored thresholds and push values win over the defaults on backfill', async () => {
    const next: AlarmsConfig = {
      ...structuredClone(DEFAULT_ALARMS_CONFIG),
      thresholds: {
        ...structuredClone(DEFAULT_ALARMS_CONFIG.thresholds),
        highWind: { thresholdKn: 25, holdMs: 30000 },
      },
      push: { ntfyTopic: 'sula-alarms', ntfyUrl: 'https://push.example.com' },
    };
    await saveAlarmsConfig(store, next);
    const cfg = await loadAlarmsConfig(store);
    expect(cfg.thresholds.highWind).toEqual({ thresholdKn: 25, holdMs: 30000 });
    expect(cfg.push).toEqual({ ntfyTopic: 'sula-alarms', ntfyUrl: 'https://push.example.com' });
  });
});

describe('isAlarmsConfig guard', () => {
  it('accepts the default config', () => {
    expect(isAlarmsConfig(DEFAULT_ALARMS_CONFIG)).toBe(true);
  });

  it('accepts a pre-v2 anchor threshold missing the sector/offset/escalation fields', () => {
    // Stored configs from before anchor watch v2 carry only
    // { armed, point?, droppedAt?, radiusM } — they must still validate.
    const cfg = {
      ...DEFAULT_ALARMS_CONFIG,
      thresholds: {
        ...DEFAULT_ALARMS_CONFIG.thresholds,
        anchor: { armed: true, point: { lat: 32.3, lon: -64.8 }, radiusM: 50 },
      },
    };
    expect(isAlarmsConfig(cfg)).toBe(true);
  });

  it('accepts a v2 anchor threshold with sector geometry and escalation', () => {
    const cfg = {
      ...DEFAULT_ALARMS_CONFIG,
      thresholds: {
        ...DEFAULT_ALARMS_CONFIG.thresholds,
        anchor: {
          armed: true,
          point: { lat: 32.3, lon: -64.8 },
          anchorPoint: { lat: 32.3005, lon: -64.8 },
          radiusM: 50,
          offsetM: 55,
          offsetBearingDeg: 0,
          coneDeg: 120,
          coneCenterDeg: 180,
          escalateAfterS: 45,
        },
      },
    };
    expect(isAlarmsConfig(cfg)).toBe(true);
  });

  it('accepts a structurally complete config with extra enabled ids', () => {
    const cfg = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, 'custom-alarm': false },
    };
    expect(isAlarmsConfig(cfg)).toBe(true);
  });

  it('rejects an empty object (the silent-disable footgun)', () => {
    // PUT {} previously replaced the live config with garbage, leaving every
    // predicate to read cfg.enabled[ID] as undefined => silently disabled.
    expect(isAlarmsConfig({})).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isAlarmsConfig(null)).toBe(false);
    expect(isAlarmsConfig(undefined)).toBe(false);
    expect(isAlarmsConfig('whatever')).toBe(false);
    expect(isAlarmsConfig(42)).toBe(false);
  });

  it('rejects a config missing the thresholds block', () => {
    expect(isAlarmsConfig({ enabled: { mob: true } })).toBe(false);
  });

  it('rejects a config missing a required threshold key', () => {
    const { overSpeed: _drop, ...partialThresholds } = DEFAULT_ALARMS_CONFIG.thresholds;
    expect(isAlarmsConfig({ enabled: {}, thresholds: partialThresholds })).toBe(false);
  });

  it('rejects an enabled map whose values are not all booleans', () => {
    const cfg = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, mob: 'yes' },
    };
    expect(isAlarmsConfig(cfg)).toBe(false);
  });

  it('accepts a config without a push block (pre-push wire shape)', () => {
    const { push: _drop, ...noPush } = DEFAULT_ALARMS_CONFIG;
    expect(isAlarmsConfig(noPush)).toBe(true);
  });

  it('accepts valid push topic/url values', () => {
    expect(
      isAlarmsConfig({
        ...DEFAULT_ALARMS_CONFIG,
        push: { ntfyTopic: 'sula-alarms_2026', ntfyUrl: 'https://push.example.com' },
      }),
    ).toBe(true);
    expect(
      isAlarmsConfig({ ...DEFAULT_ALARMS_CONFIG, push: { ntfyTopic: null, ntfyUrl: null } }),
    ).toBe(true);
  });

  it('rejects a push topic with URL-unsafe characters or over-length', () => {
    for (const bad of ['has space', 'slash/y', 'topic!', 'x'.repeat(65), '']) {
      expect(
        isAlarmsConfig({ ...DEFAULT_ALARMS_CONFIG, push: { ntfyTopic: bad, ntfyUrl: null } }),
      ).toBe(false);
    }
  });

  it('rejects a push url that is not an http(s) URL', () => {
    for (const bad of ['not a url', 'ftp://x.example', 'ntfy.sh']) {
      expect(
        isAlarmsConfig({ ...DEFAULT_ALARMS_CONFIG, push: { ntfyTopic: null, ntfyUrl: bad } }),
      ).toBe(false);
    }
  });
});
