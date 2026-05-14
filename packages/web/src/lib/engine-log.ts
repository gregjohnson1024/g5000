import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './paths';

const ENGINE_LOG_PATH = join(ROOT, 'engine-log.json');

export type EngineKey = 'port' | 'stbd';

export interface EngineState {
  on: boolean;
  /** RPM, if known. Optional — fine to log on/off without it. */
  rpm?: number;
}

export interface EngineEntry {
  /** UNIX seconds. Entries are sorted ascending by `t` on every write
   *  so a backdated insert lands in the right place. */
  t: number;
  port: EngineState;
  stbd: EngineState;
  /** Optional free-form note (e.g. "fuel xfer", "high vibration"). */
  note?: string;
}

export interface EngineBaseline {
  /** Engine-meter reading at the start of g5000-tracked logging, hours.
   *  Added to g5000-tracked running time to produce a "lifetime hours"
   *  display. Optional — defaults to 0. */
  port: number;
  stbd: number;
}

export interface EngineLogFile {
  baseline: EngineBaseline;
  entries: EngineEntry[];
}

export interface EngineHoursSummary {
  /** Hours g5000 has observed each engine as `on`. */
  trackedHours: { port: number; stbd: number };
  /** Baseline + tracked. */
  totalHours: { port: number; stbd: number };
  /** Engine state RIGHT NOW (== state of the most recent entry whose
   *  t <= now). null if no entries yet. */
  current: { port: EngineState; stbd: EngineState; t: number } | null;
}

async function readFile(): Promise<EngineLogFile> {
  try {
    const buf = await fs.readFile(ENGINE_LOG_PATH, 'utf8');
    const j = JSON.parse(buf) as Partial<EngineLogFile>;
    return normalize(j);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { baseline: { port: 0, stbd: 0 }, entries: [] };
    }
    throw err;
  }
}

function normalize(j: Partial<EngineLogFile>): EngineLogFile {
  const baseline: EngineBaseline = {
    port: Number(j.baseline?.port) || 0,
    stbd: Number(j.baseline?.stbd) || 0,
  };
  const entries = (Array.isArray(j.entries) ? j.entries : [])
    .filter((e): e is EngineEntry => {
      if (!e || typeof e !== 'object') return false;
      const r = e as unknown as Record<string, unknown>;
      if (typeof r.t !== 'number') return false;
      if (!r.port || !r.stbd) return false;
      return true;
    })
    .map((e) => ({
      t: e.t,
      port: { on: !!e.port.on, ...(typeof e.port.rpm === 'number' ? { rpm: e.port.rpm } : {}) },
      stbd: { on: !!e.stbd.on, ...(typeof e.stbd.rpm === 'number' ? { rpm: e.stbd.rpm } : {}) },
      ...(typeof e.note === 'string' && e.note ? { note: e.note } : {}),
    }))
    .sort((a, b) => a.t - b.t);
  return { baseline, entries };
}

async function writeFile(f: EngineLogFile): Promise<void> {
  await fs.mkdir(dirname(ENGINE_LOG_PATH), { recursive: true });
  const tmp = ENGINE_LOG_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(f, null, 2));
  await fs.rename(tmp, ENGINE_LOG_PATH);
}

export async function readEngineLog(): Promise<EngineLogFile> {
  return readFile();
}

export async function appendEngineEntry(entry: EngineEntry): Promise<EngineLogFile> {
  const f = await readFile();
  f.entries.push(entry);
  f.entries.sort((a, b) => a.t - b.t);
  await writeFile(f);
  return f;
}

export async function setEngineBaseline(baseline: Partial<EngineBaseline>): Promise<EngineLogFile> {
  const f = await readFile();
  if (typeof baseline.port === 'number' && Number.isFinite(baseline.port)) {
    f.baseline.port = baseline.port;
  }
  if (typeof baseline.stbd === 'number' && Number.isFinite(baseline.stbd)) {
    f.baseline.stbd = baseline.stbd;
  }
  await writeFile(f);
  return f;
}

/**
 * Sum hours each engine was `on`. Walks adjacent entries and credits
 * the interval [entry[i].t, entry[i+1].t] to whichever engines were
 * marked `on` in entry[i]. The trailing interval from the last entry
 * to `nowS` is credited too if its engines are still `on`.
 */
export function computeEngineHours(
  f: EngineLogFile,
  nowS: number = Date.now() / 1000,
): EngineHoursSummary {
  let portSec = 0;
  let stbdSec = 0;
  const entries = f.entries;
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i]!;
    const next = entries[i + 1]?.t ?? nowS;
    const dt = Math.max(0, next - cur.t);
    if (cur.port.on) portSec += dt;
    if (cur.stbd.on) stbdSec += dt;
  }
  const tracked = { port: portSec / 3600, stbd: stbdSec / 3600 };
  const total = {
    port: f.baseline.port + tracked.port,
    stbd: f.baseline.stbd + tracked.stbd,
  };
  // Current state: most recent entry whose t <= nowS.
  let current: EngineHoursSummary['current'] = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.t <= nowS) {
      const e = entries[i]!;
      current = { port: e.port, stbd: e.stbd, t: e.t };
      break;
    }
  }
  return { trackedHours: tracked, totalHours: total, current };
}
