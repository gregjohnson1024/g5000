import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MastService } from './service.js';
import { DEFAULT_MAST_LAYOUT } from '@g5000/mast';

const valid = {
  version: 1,
  pages: [{ id: 'p', label: 'P', grid: '1', condition: { always: true }, tiles: [{ field: 'nav.gps.sog', label: 'SOG', units: 'kn', decimals: 2 }] }],
};

describe('MastService', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mast-'));
    file = path.join(dir, 'mast-layout.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('falls back to DEFAULT_MAST_LAYOUT when the file is missing', async () => {
    const svc = await MastService.start(file);
    expect(svc.getLayout()).toEqual(DEFAULT_MAST_LAYOUT);
    await svc.stop();
  });

  it('loads a valid file at startup', async () => {
    writeFileSync(file, JSON.stringify(valid));
    const svc = await MastService.start(file);
    expect(svc.getLayout().pages[0]!.id).toBe('p');
    await svc.stop();
  });

  it('keeps the last good layout when the file becomes invalid', async () => {
    writeFileSync(file, JSON.stringify(valid));
    const svc = await MastService.start(file);
    writeFileSync(file, '{ not json');
    await svc.reloadNow(); // deterministic reload for the test (watcher does this on change)
    expect(svc.getLayout().pages[0]!.id).toBe('p');
    await svc.stop();
  });

  it('keeps the last good layout when a valid-JSON file fails validation', async () => {
    writeFileSync(file, JSON.stringify(valid));
    const svc = await MastService.start(file);
    writeFileSync(file, JSON.stringify({ version: 1, pages: [] })); // parses, but fails validation (empty pages)
    await svc.reloadNow();
    expect(svc.getLayout().pages[0]!.id).toBe('p');
    await svc.stop();
  });

  it('tracks the override and clears it', async () => {
    const svc = await MastService.start(file);
    expect(svc.getOverride()).toBeNull();
    svc.setOverride('p');
    expect(svc.getOverride()).toBe('p');
    svc.setOverride(null);
    expect(svc.getOverride()).toBeNull();
    await svc.stop();
  });
});
