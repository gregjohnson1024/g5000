import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/synthetic-tiny.json');

describe('parseGrib2Json', () => {
  it('assembles a WindField from u10 + v10 messages on a 2x2 grid at 2 timesteps', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const field = parseGrib2Json(messages, 'GFS', 1715500800);

    expect(field.source).toBe('GFS');
    expect(field.runTime).toBe(1715500800);
    expect(field.lats).toEqual([30, 31]);
    expect(field.lons).toEqual([-75, -74]);
    expect(field.times.length).toBe(2);
    expect(field.u.length).toBe(2);
    expect(field.u[0]!.length).toBe(2); // 2 lats
    expect(field.u[0]![0]!.length).toBe(2); // 2 lons
    expect(field.u[0]![0]![0]).toBeCloseTo(5.0, 6);
    expect(field.v[0]![0]![0]).toBeCloseTo(2.0, 6);
  });

  it('throws when u10 and v10 grids do not align', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    messages[1]!.grid.lats = [30, 31, 32]; // mismatched
    expect(() => parseGrib2Json(messages, 'GFS', 1715500800)).toThrow(/grid mismatch/i);
  });

  it('throws when a required variable is missing', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const noV = messages.filter((m) => m.variable !== 'VGRD');
    expect(() => parseGrib2Json(noV, 'GFS', 1715500800)).toThrow(/missing.*VGRD/i);
  });
});
