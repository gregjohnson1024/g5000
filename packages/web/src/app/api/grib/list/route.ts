import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GRIB_CACHE } from '../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CacheEntry {
  model: string;
  runTime: string;
  size: number;
  mtime: number;
}

export async function GET(): Promise<Response> {
  if (!existsSync(GRIB_CACHE)) {
    return Response.json({ ok: true, items: [] });
  }
  const items: CacheEntry[] = [];
  let models: string[];
  try {
    models = await readdir(GRIB_CACHE);
  } catch {
    return Response.json({ ok: true, items: [] });
  }
  for (const model of models) {
    const modelDir = join(GRIB_CACHE, model);
    let modelStat;
    try {
      modelStat = await stat(modelDir);
    } catch {
      continue;
    }
    if (!modelStat.isDirectory()) continue;
    const runs = await readdir(modelDir);
    for (const run of runs) {
      const runDir = join(modelDir, run);
      let runStat;
      try {
        runStat = await stat(runDir);
      } catch {
        continue;
      }
      if (!runStat.isDirectory()) continue;
      let size = 0;
      let mtime = 0;
      const bboxDirs = await readdir(runDir);
      for (const bboxDir of bboxDirs) {
        const bboxPath = join(runDir, bboxDir);
        let bboxStat;
        try {
          bboxStat = await stat(bboxPath);
        } catch {
          continue;
        }
        if (!bboxStat.isDirectory()) continue;
        const files = await readdir(bboxPath);
        for (const f of files) {
          try {
            const s = await stat(join(bboxPath, f));
            if (!s.isFile()) continue;
            size += s.size;
            if (s.mtimeMs > mtime) mtime = s.mtimeMs;
          } catch {
            // ignore missing file
          }
        }
      }
      items.push({ model, runTime: run, size, mtime });
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return Response.json({ ok: true, items });
}
