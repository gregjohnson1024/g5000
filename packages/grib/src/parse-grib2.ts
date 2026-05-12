import { spawn } from 'node:child_process';
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
 * Runtime path: invoke `wgrib2` on a file, parse its `-V` inventory plus
 * a per-message `-csv` dump, and return normalized messages. Exposed for
 * the fetch-pipeline integration tests; unit tests use `parseGrib2Json`
 * directly against fixtures so wgrib2's quirks don't pollute the test
 * surface.
 */
export async function runWgrib2(gribPath: string): Promise<Grib2JsonMessage[]> {
  // Plain inventory: one line per message, colon-separated positional fields:
  //   <idx>:<offset>:d=YYYYMMDDHH:<VAR>:<LEVEL>:<N> hour fcst:
  // We use this rather than -V because the verbose format embeds the variable
  // name in a free-text description (e.g. "UGRD U-Component of Wind [m/s]")
  // that's awkward to parse.
  const inv = await spawnText('wgrib2', [gribPath]);
  const messages: Grib2JsonMessage[] = [];

  for (const rawLine of inv.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Split on ':' — fields are positional; trailing ':' yields a trailing
    // empty string we can ignore.
    const parts = line.split(':');
    if (parts.length < 6) continue;
    const idx = Number(parts[0]);
    if (!Number.isFinite(idx)) continue;
    const runMatch = parts[2]!.match(/^d=(\d{10})$/);
    if (!runMatch) continue;
    const runRaw = runMatch[1]!;
    const runTimeUnix = Date.UTC(
      Number(runRaw.slice(0, 4)),
      Number(runRaw.slice(4, 6)) - 1,
      Number(runRaw.slice(6, 8)),
      Number(runRaw.slice(8, 10)),
    ) / 1000;
    const variable = parts[3]!;
    const level = parts[4]!.trim();
    // Forecast description like "6 hour fcst" or "anl"; "anl" → 0h.
    const fcstField = parts[5]!.trim();
    const fcstHourMatch = fcstField.match(/(\d+)\s*hour\s*fcst/);
    const fcstHours = fcstHourMatch ? Number(fcstHourMatch[1]) : 0;
    const ft = runTimeUnix + fcstHours * 3600;

    // Skip variables outside our whitelist.
    if (!['UGRD', 'VGRD', 'UOGRD', 'VOGRD', 'PRMSL'].includes(variable)) continue;

    // Dump this message's grid + values via -csv. Pass `-inv /dev/null` so
    // wgrib2 doesn't prepend its inventory text to the CSV stream.
    const csv = await spawnText('wgrib2', [
      gribPath,
      '-inv',
      '/dev/null',
      '-d',
      String(idx),
      '-csv',
      '-',
    ]);
    const { lats, lons, values } = parseWgrib2Csv(csv);
    messages.push({
      variable: variable as Grib2JsonMessage['variable'],
      level,
      forecastTime: ft,
      grid: { lats, lons },
      values,
    });
  }
  return messages;
}

function spawnText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', rejectP);
    p.on('close', (code) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${err}`));
    });
  });
}

/**
 * Parse wgrib2 -csv output. Format: one line per grid point,
 *   "time","var","level",lon,lat,value
 * lon is 0..360; we shift to -180..180.
 */
function parseWgrib2Csv(csv: string): { lats: number[]; lons: number[]; values: number[][] } {
  const latsSet = new Set<number>();
  const lonsSet = new Set<number>();
  const records: Array<{ lat: number; lon: number; v: number }> = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    // last 3 columns: lon, lat, value
    const lon0 = Number(parts[parts.length - 3]);
    const lat = Number(parts[parts.length - 2]);
    const value = Number(parts[parts.length - 1]);
    const lon = lon0 > 180 ? lon0 - 360 : lon0;
    latsSet.add(lat);
    lonsSet.add(lon);
    records.push({ lat, lon, v: value });
  }
  const lats = [...latsSet].sort((a, b) => a - b);
  const lons = [...lonsSet].sort((a, b) => a - b);
  const values: number[][] = lats.map(() => lons.map(() => NaN));
  for (const r of records) {
    const yi = lats.indexOf(r.lat);
    const xi = lons.indexOf(r.lon);
    values[yi]![xi] = r.v;
  }
  return { lats, lons, values };
}
