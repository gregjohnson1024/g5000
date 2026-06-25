import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom, skip, take } from 'rxjs';
import { ConfigStore } from './config-store.js';

describe('ConfigStore radarConfig', () => {
  let dir: string;
  let dbPath: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-cfg-radar-'));
    dbPath = path.join(dir, 'config.db');
    store = await ConfigStore.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on a fresh database', () => {
    expect(store.getRadarConfig()).toBeNull();
  });

  it('round-trips radar config', async () => {
    store.setRadarConfig({ mayaraBaseUrl: 'http://pi:6502', defaultRangeM: 4000 });
    expect(store.getRadarConfig()).toEqual({
      mayaraBaseUrl: 'http://pi:6502',
      defaultRangeM: 4000,
    });
  });

  it('emits the new value on radarConfig$ when setRadarConfig is called', async () => {
    const next = firstValueFrom(store.radarConfig$.pipe(skip(1), take(1)));
    store.setRadarConfig({ mayaraBaseUrl: 'http://radar:6502' });
    const v = await next;
    expect(v).toEqual({ mayaraBaseUrl: 'http://radar:6502' });
  });

  it('persists radar config across reopens', async () => {
    store.setRadarConfig({ mayaraBaseUrl: 'http://pi:6502', defaultRangeM: 2000 });
    await store.close();
    store = await ConfigStore.open(dbPath);
    expect(store.getRadarConfig()).toEqual({
      mayaraBaseUrl: 'http://pi:6502',
      defaultRangeM: 2000,
    });
  });

  it('late subscribers get the current value from radarConfig$', async () => {
    store.setRadarConfig({ mayaraBaseUrl: 'http://pi:6502' });
    const v = await firstValueFrom(store.radarConfig$);
    expect(v).toEqual({ mayaraBaseUrl: 'http://pi:6502' });
  });
});
