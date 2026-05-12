import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWgrib2, parseGrib2Json } from './parse-grib2.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/gfs-sample.grb2');

describe('runWgrib2 (integration — requires wgrib2 on PATH)', () => {
  it('reads UGRD and VGRD from the GFS fixture', async () => {
    const messages = await runWgrib2(FIXTURE);
    const u = messages.find((m) => m.variable === 'UGRD');
    const v = messages.find((m) => m.variable === 'VGRD');
    expect(u).toBeDefined();
    expect(v).toBeDefined();
    expect(u!.grid.lats.length).toBeGreaterThan(0);
    expect(u!.grid.lons.length).toBeGreaterThan(0);
    expect(u!.values.length).toBe(u!.grid.lats.length);
    expect(u!.values[0]!.length).toBe(u!.grid.lons.length);
  });

  it('parseGrib2Json consumes the runWgrib2 output into a WindField', async () => {
    const messages = await runWgrib2(FIXTURE);
    const field = parseGrib2Json(messages, 'GFS', 0);
    expect(field.lats.length).toBe(messages[0]!.grid.lats.length);
    expect(field.u.length).toBe(1); // single forecast hour in this fixture
  });
});
