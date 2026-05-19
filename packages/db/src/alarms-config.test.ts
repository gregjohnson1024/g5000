import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  loadAlarmsConfig,
  saveAlarmsConfig,
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
