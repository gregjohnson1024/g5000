import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GRIB_CACHE } from '../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CacheEntry {
  model: string;
  runTime: string;
  size: number;
  mtime: number;
}

async function listCache(): Promise<CacheEntry[]> {
  if (!existsSync(GRIB_CACHE)) return [];
  const items: CacheEntry[] = [];
  let models: string[];
  try {
    models = await readdir(GRIB_CACHE);
  } catch {
    return [];
  }
  for (const model of models) {
    const modelDir = join(GRIB_CACHE, model);
    try {
      const s = await stat(modelDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    const runs = await readdir(modelDir);
    for (const run of runs) {
      const runDir = join(modelDir, run);
      try {
        const s = await stat(runDir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      let size = 0;
      let mtime = 0;
      const bboxDirs = await readdir(runDir);
      for (const bboxDir of bboxDirs) {
        const bboxPath = join(runDir, bboxDir);
        try {
          const s = await stat(bboxPath);
          if (!s.isDirectory()) continue;
        } catch {
          continue;
        }
        const files = await readdir(bboxPath);
        for (const f of files) {
          try {
            const fs2 = await stat(join(bboxPath, f));
            if (!fs2.isFile()) continue;
            size += fs2.size;
            if (fs2.mtimeMs > mtime) mtime = fs2.mtimeMs;
          } catch {
            // ignore
          }
        }
      }
      items.push({ model, runTime: run, size, mtime });
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function formatRunTime(run: string): string {
  const n = Number(run);
  if (!Number.isFinite(n) || n <= 0) return run;
  return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function formatMtime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export default async function GribCachePage() {
  const items = await listCache();
  const totalSize = items.reduce((acc, it) => acc + it.size, 0);
  return (
    <main className="p-8 max-w-4xl">
      <h1 className="text-2xl mb-2">GRIB Cache</h1>
      <div className="text-xs text-slate-500 mb-4">
        {items.length} run{items.length === 1 ? '' : 's'} · {formatSize(totalSize)} total
      </div>
      {items.length === 0 && <div className="text-slate-400">Cache is empty.</div>}
      {items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Run time (UTC)</th>
              <th className="py-2 pr-4 text-right">Size</th>
              <th className="py-2 pr-4">Last modified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((it) => (
              <tr key={`${it.model}/${it.runTime}`}>
                <td className="py-2 pr-4 uppercase">{it.model}</td>
                <td className="py-2 pr-4 font-mono text-xs">{formatRunTime(it.runTime)}</td>
                <td className="py-2 pr-4 text-right">{formatSize(it.size)}</td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                  {formatMtime(it.mtime)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
