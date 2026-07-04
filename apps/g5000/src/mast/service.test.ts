import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom } from 'rxjs';
import { MastService } from './service.js';
import { DEFAULT_MAST_LAYOUT } from '@g5000/mast';
import { ConfigStore } from '@g5000/db';

const valid = {
  version: 1,
  pages: [
    {
      id: 'p',
      label: 'P',
      grid: '1',
      condition: { always: true },
      tiles: [{ field: 'nav.gps.sog', label: 'SOG', units: 'kn', decimals: 2 }],
    },
  ],
};

// A second valid layout distinct from `valid` and DEFAULT.
const valid2 = {
  version: 1,
  pages: [
    {
      id: 'q',
      label: 'Q',
      grid: '1',
      condition: { always: true },
      tiles: [{ field: 'nav.gps.sog', label: 'SOG', units: 'kn', decimals: 2 }],
    },
  ],
};

describe('MastService', () => {
  let dir: string;
  let dbPath: string;
  let file: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mast-'));
    dbPath = path.join(dir, 'config.db');
    file = path.join(dir, 'mast-layout.json');
    store = await ConfigStore.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds DEFAULT_MAST_LAYOUT when the file is missing', async () => {
    const svc = await MastService.start(store, file);
    expect(svc.getLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    expect(store.getMastLayout()).not.toBeNull();
    // layout$ emits the seeded default
    const emitted = await firstValueFrom(svc.layout$);
    expect(emitted).toEqual(DEFAULT_MAST_LAYOUT);
    await svc.stop();
  });

  it('seeds the layout from a valid file', async () => {
    writeFileSync(file, JSON.stringify(valid));
    const svc = await MastService.start(store, file);
    expect(svc.getLayout().pages[0]!.id).toBe('p');
    expect(store.getMastLayout()!.pages[0]!.id).toBe('p');
    await svc.stop();
  });

  it('falls back to DEFAULT_MAST_LAYOUT when the file has invalid JSON', async () => {
    writeFileSync(file, '{ not json');
    const svc = await MastService.start(store, file);
    expect(svc.getLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    expect(store.getMastLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    await svc.stop();
  });

  it('falls back to DEFAULT_MAST_LAYOUT when the file has valid JSON but fails validation', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, pages: [] })); // empty pages fails validation
    const svc = await MastService.start(store, file);
    expect(svc.getLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    expect(store.getMastLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    await svc.stop();
  });

  it('skips seeding if ConfigStore already has a layout', async () => {
    // Pre-seed valid2 into the store — different from both valid and DEFAULT.
    await store.setMastLayout(valid2 as Parameters<typeof store.setMastLayout>[0]);
    // Write `valid` to the file — if seed ran it would produce pages[0].id === 'p'.
    writeFileSync(file, JSON.stringify(valid));
    const svc = await MastService.start(store, file);
    // Must still have valid2 (seed skipped).
    expect(svc.getLayout().pages[0]!.id).toBe('q');
    expect(store.getMastLayout()!.pages[0]!.id).toBe('q');
    await svc.stop();
  });

  it('tracks the override and clears it', async () => {
    const svc = await MastService.start(store, file);
    expect(svc.getOverride()).toBeNull();
    svc.setOverride('p');
    expect(svc.getOverride()).toBe('p');
    svc.setOverride(null);
    expect(svc.getOverride()).toBeNull();
    await svc.stop();
  });
});
