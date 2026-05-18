import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom } from 'rxjs';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET, POST } from './route.js';

describe('/api/wardrobe/active', () => {
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

  it('GET returns the active SailConfig JSON (v2 shape)', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('name');
    expect(json).toHaveProperty('modes');
    expect(typeof json.modes).toBe('object');
  });

  it('accepts an optional activeMode and persists it', async () => {
    const res = await POST(
      new Request('http://x/api/wardrobe/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activeConfigId: 'default', activeMode: 'foiling' }),
      }),
    );
    expect(res.status).toBe(200);
    const wardrobe = await firstValueFrom(store.sails$);
    expect(wardrobe.activeMode).toBe('foiling');
  });
});
