import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom, take, skip } from 'rxjs';
import { ConfigStore } from './config-store.js';
import { DEFAULT_BOAT_CONFIG, DEFAULT_AWS_AWA_CAL, type BoatConfig } from './defaults.js';

describe('ConfigStore', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-cfg-'));
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
});
