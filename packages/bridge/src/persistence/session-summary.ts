import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';

const EXT = '.jsonl.gz';

export interface SessionInfo {
  id: string;
  sizeBytes: number;
  mtime: string;
  startedAt?: string;
}

export interface SessionSummary extends SessionInfo {
  canLines: number;
  otLines: number;
  durationMs: number;
  firstEventNs?: string;
  lastEventNs?: string;
}

export async function listSessions(dir: string): Promise<SessionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files = entries.filter((e) => e.endsWith(EXT));
  const out: SessionInfo[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const st = await stat(full);
    out.push({
      id: f.slice(0, -EXT.length),
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
      startedAt: await readHeaderStartedAt(full),
    });
  }
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return out;
}

async function readHeaderStartedAt(filePath: string): Promise<string | undefined> {
  const lines = openLineReader(filePath);
  try {
    for await (const raw of lines) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { kind?: string; startedAt?: string };
        if (parsed.kind === 'header') return parsed.startedAt;
      } catch {
        return undefined;
      }
      return undefined;
    }
  } catch {
    // Tolerate truncated or still-open gzip streams (e.g., the live session
    // log file held open by an autopilot-server in record mode). Returning
    // undefined here lets listSessions still surface the file in the listing
    // with mtime/size only.
    return undefined;
  } finally {
    lines.close();
  }
  return undefined;
}

export async function summarizeSession(filePath: string): Promise<SessionSummary> {
  const st = await stat(filePath);
  const base = path.basename(filePath);
  if (!base.endsWith(EXT)) {
    throw new Error(`Not a session file: ${filePath}`);
  }
  const id = base.slice(0, -EXT.length);

  let canLines = 0;
  let otLines = 0;
  let firstNs: bigint | undefined;
  let lastNs: bigint | undefined;
  let startedAt: string | undefined;

  const lines = openLineReader(filePath);
  try {
    for await (const raw of lines) {
      if (!raw) continue;
      let parsed: { kind?: string; t_ns?: string; startedAt?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (parsed.kind === 'header') {
        startedAt = parsed.startedAt;
        continue;
      }
      if (parsed.kind === 'can') canLines += 1;
      else if (parsed.kind === '0183') otLines += 1;
      else continue;
      if (parsed.t_ns) {
        const ns = BigInt(parsed.t_ns);
        if (firstNs === undefined) firstNs = ns;
        lastNs = ns;
      }
    }
  } catch {
    // Tolerate truncated or still-open gzip streams. Partial counts are
    // returned with whatever was successfully read so the UI can still show
    // a meaningful summary for a live or interrupted session log.
  } finally {
    lines.close();
  }

  const durationMs =
    firstNs !== undefined && lastNs !== undefined
      ? Math.round(Number(lastNs - firstNs) / 1_000_000)
      : 0;

  return {
    id,
    sizeBytes: st.size,
    mtime: st.mtime.toISOString(),
    startedAt,
    canLines,
    otLines,
    durationMs,
    firstEventNs: firstNs?.toString(),
    lastEventNs: lastNs?.toString(),
  };
}

function openLineReader(filePath: string) {
  const file = createReadStream(filePath);
  const gunzip = createGunzip();
  return createInterface({ input: file.pipe(gunzip) });
}
