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
  });
});

describe('isAlarmsConfig guard', () => {
  it('accepts the default config', () => {
    expect(isAlarmsConfig(DEFAULT_ALARMS_CONFIG)).toBe(true);
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
});
