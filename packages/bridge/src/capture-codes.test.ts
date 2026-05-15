import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readCaptureCodes } from './capture-codes.js';

describe('readCaptureCodes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-codes-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty captures when file is missing', async () => {
    const r = await readCaptureCodes(path.join(tmpDir, 'missing.json'));
    expect(r).toEqual({ version: 1, captures: {} });
  });

  it('parses a well-formed file', async () => {
    const p = path.join(tmpDir, 'codes.json');
    await fs.writeFile(p, JSON.stringify({
      version: 1,
      captures: {
        'course_+1': { fields: { Event: 'Change course', Direction: 'Starboard', Angle: 1 } },
      },
    }));
    const r = await readCaptureCodes(p);
    expect(r.captures['course_+1']?.fields['Direction']).toBe('Starboard');
  });

  it('returns empty captures on parse error', async () => {
    const p = path.join(tmpDir, 'bad.json');
    await fs.writeFile(p, '{ not valid json');
    const r = await readCaptureCodes(p);
    expect(r).toEqual({ version: 1, captures: {} });
  });
});
