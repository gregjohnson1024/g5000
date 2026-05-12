import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET } from './route.js';

describe('GET /api/wardrobe/active', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-web-wardrobe-active-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
    setSharedConfigStore(store);
  });

  afterEach(async () => {
    _resetSharedConfigStoreForTests();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the active SailConfig JSON', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('polar');
    expect(json.polar).toHaveProperty('twsBins');
    expect(json.polar).toHaveProperty('twaBins');
    expect(json.polar).toHaveProperty('boatSpeed');
  });
});
