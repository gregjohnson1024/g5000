import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let tracks: typeof import('./tracks');

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-tracks-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  tracks = await import('./tracks');
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('listTracks file filtering', () => {
  it('ignores non-canonical .json files like .bak.json backups', async () => {
    const t = await tracks.createTrack('real');
    // A leftover backup that still ends in .json and carries the same id —
    // exactly the situation that caused duplicate React keys on /tracks.
    const dump = await tracks.getTrack(t.id);
    writeFileSync(join(tracks.TRACKS_DIR, `${t.id}.pre-merge.bak.json`), JSON.stringify(dump));

    const metas = await tracks.listTracks();

    expect(metas).toHaveLength(1);
    expect(metas[0]!.id).toBe('track-001');
  });

  it('lists every canonical track-NNN.json once', async () => {
    await tracks.createTrack('one');
    await tracks.interruptActive('two'); // ends track-001, creates track-002

    const metas = await tracks.listTracks();

    expect(metas.map((m) => m.id)).toEqual(['track-001', 'track-002']);
  });
});
