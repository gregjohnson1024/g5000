import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom } from 'rxjs';
import { ConfigStore } from './config-store.js';
import type { SailWardrobe } from './defaults.js';

describe('ConfigStore.setSails (v3)', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-cfg-v3-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid v3 wardrobe', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: ['10,5'] } },
        { id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } },
      ],
      active: { headsail: 'j0', main: 'reef1' },
      activeMode: 'default',
    };
    await expect(store.setSails(w)).resolves.toBeUndefined();
    const stored = await firstValueFrom(store.sails$);
    expect(stored.sails).toHaveLength(2);
    expect(stored.active).toEqual({ headsail: 'j0', main: 'reef1' });
  });

  it('rejects duplicate sail ids', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
        { id: 'j0', name: 'J0 again', category: 'headsail', region: { cells: [] } },
      ],
      active: {},
      activeMode: 'default',
    };
    await expect(store.setSails(w)).rejects.toThrow(/duplicate/i);
  });

  it('rejects sails with an unknown category', async () => {
    const w = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'mystery', name: 'Mystery', category: 'spinnaker' as any, region: { cells: [] } },
      ],
      active: {},
      activeMode: 'default',
    } as SailWardrobe;
    await expect(store.setSails(w)).rejects.toThrow(/unknown category/i);
  });

  it('drops stale active references silently (wrong category)', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } }],
      // 'reef1' is a main, but the active slot is "headsail" — must clear silently.
      active: { headsail: 'reef1' },
      activeMode: 'default',
    };
    await store.setSails(w);
    const stored = await firstValueFrom(store.sails$);
    expect(stored.active.headsail).toBeUndefined();
  });

  it('clears active reference when a sail is deleted', async () => {
    await store.setSails({
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
      active: { headsail: 'j0' },
      activeMode: 'default',
    });
    await store.setSails({
      schemaVersion: 3,
      boatId: 'sula',
      sails: [],
      active: { headsail: 'j0' },
      activeMode: 'default',
    });
    const stored = await firstValueFrom(store.sails$);
    expect(stored.active.headsail).toBeUndefined();
  });

  it('rejects wrong schemaVersion', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.setSails({ schemaVersion: 2 } as any),
    ).rejects.toThrow(/schemaVersion/);
  });
});
