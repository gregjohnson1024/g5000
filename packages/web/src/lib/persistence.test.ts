import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson, readJson, listJson } from './persistence';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'router-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('persistence', () => {
  it('writeJson + readJson roundtrip', async () => {
    const p = join(dir, 'foo.json');
    await writeJson(p, { a: 1, b: [2, 3] });
    expect(await readJson(p)).toEqual({ a: 1, b: [2, 3] });
  });
  it('readJson returns null when file missing', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeNull();
  });
  it('listJson returns sorted filenames', async () => {
    await writeJson(join(dir, 'b.json'), { id: 'b' });
    await writeJson(join(dir, 'a.json'), { id: 'a' });
    expect(await listJson(dir)).toEqual(['a.json', 'b.json']);
  });
});
