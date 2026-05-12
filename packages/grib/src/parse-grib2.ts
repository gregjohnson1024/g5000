import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { WindField, CurrentField } from './types.js';

/**
 * One parsed message from `wgrib2 -json` output.
 *
 * Note: `wgrib2 -json` actually emits a different schema than this; in
 * practice we run `wgrib2 <file> -inv /dev/null -no_header -bin -` and post-
 * process, but for the public TypeScript interface we model a normalized
 * shape that we adapt to from whatever wgrib2 hands us.
 *
 * The fixture-driven tests use this shape directly. The runtime path lives
 * in `runWgrib2()` below and is exercised by integration tests.
 */
export interface Grib2JsonMessage {
  variable: 'UGRD' | 'VGRD' | 'UOGRD' | 'VOGRD' | 'PRMSL';
  level: string;
  /** Unix seconds for the *valid* time of this message. */
  forecastTime: number;
  grid: { lats: number[]; lons: number[] };
  /** values[lat][lon] in the native units (m/s for wind, m/s for currents). */
  values: number[][];
}

export function parseGrib2Json(
  messages: Grib2JsonMessage[],
  source: WindField['source'] | CurrentField['source'],
  runTime: number,
): WindField | CurrentField {
  const uVar = source === 'RTOFS' ? 'UOGRD' : 'UGRD';
  const vVar = source === 'RTOFS' ? 'VOGRD' : 'VGRD';

  const us = messages.filter((m) => m.variable === uVar);
  const vs = messages.filter((m) => m.variable === vVar);

  if (us.length === 0) throw new Error(`parseGrib2Json: missing ${uVar} messages`);
  if (vs.length === 0) throw new Error(`parseGrib2Json: missing ${vVar} messages`);
  if (us.length !== vs.length) {
    throw new Error(`parseGrib2Json: ${uVar} (${us.length}) and ${vVar} (${vs.length}) count differs`);
  }

  // Sort both lists by forecastTime ascending.
  us.sort((a, b) => a.forecastTime - b.forecastTime);
  vs.sort((a, b) => a.forecastTime - b.forecastTime);

  const lats = us[0]!.grid.lats;
  const lons = us[0]!.grid.lons;
  const times: number[] = [];
  const u: number[][][] = [];
  const v: number[][][] = [];

  for (let i = 0; i < us.length; i++) {
    const uMsg = us[i]!;
    const vMsg = vs[i]!;
    if (uMsg.forecastTime !== vMsg.forecastTime) {
      throw new Error(
        `parseGrib2Json: time mismatch at step ${i}: u=${uMsg.forecastTime} v=${vMsg.forecastTime}`,
      );
    }
    if (!arraysEqual(uMsg.grid.lats, lats) || !arraysEqual(uMsg.grid.lons, lons)) {
      throw new Error(`parseGrib2Json: grid mismatch at step ${i} (UGRD)`);
    }
    if (!arraysEqual(vMsg.grid.lats, lats) || !arraysEqual(vMsg.grid.lons, lons)) {
      throw new Error(`parseGrib2Json: grid mismatch at step ${i} (VGRD)`);
    }
    times.push(uMsg.forecastTime);
    u.push(uMsg.values);
    v.push(vMsg.values);
  }

  return { lats, lons, times, u, v, source, runTime } as WindField | CurrentField;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Runtime path: invoke `wgrib2` on a file, parse its CSV-style inventory
 * + binary dump, and return normalized messages. Exposed for the fetch-
 * pipeline integration tests; unit tests use `parseGrib2Json` directly
 * against fixtures so wgrib2's quirks don't pollute the test surface.
 */
export async function runWgrib2(gribPath: string): Promise<Grib2JsonMessage[]> {
  // wgrib2 -V dumps a per-message inventory we can parse; for actual
  // values we re-run with `-csv -` per message. This function is fleshed
  // out in Task 8 once we have a real GRIB file to test against.
  void gribPath;
  void spawn;
  void readFile;
  throw new Error('runWgrib2: implemented in Task 8');
}
