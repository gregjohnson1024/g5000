/**
 * Inspect and prune the Esri satellite tile cache from the command line
 * (headless / ssh). Shares the prune + stats core with the /settings admin
 * UI via packages/web/src/lib/sat-cache.ts — single source of truth.
 *
 *   npx tsx scripts/sat-cache.ts report
 *   npx tsx scripts/sat-cache.ts prune --older-than-days=90
 *   npx tsx scripts/sat-cache.ts prune --max-gb=8
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readCacheStats, pruneCache, CAP_BYTES } from '../packages/web/src/lib/sat-cache';

const CACHE_ROOT = join(
  process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router'),
  'sat-cache',
);

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function parseArg(flag: string): string | undefined {
  return process.argv.find((x) => x.startsWith(flag + '='))?.split('=')[1];
}

async function report(): Promise<void> {
  const s = await readCacheStats(CACHE_ROOT);
  console.log(`cache: ${CACHE_ROOT}`);
  console.log(`total: ${gb(s.totalBytes)} of ${gb(s.capBytes)} cap · ${s.tileCount} tiles`);
  for (const z of Object.keys(s.byZoom)
    .map(Number)
    .sort((a, b) => a - b)) {
    console.log(`  z${z}: ${s.byZoom[z]!.tiles} tiles, ${gb(s.byZoom[z]!.bytes)}`);
  }
  if (s.totalBytes > s.capBytes) console.warn('WARNING: over cap — run `prune`.');
  else if (s.totalBytes > s.capBytes * 0.9) console.warn('NOTE: within 10% of cap.');
}

async function prune(): Promise<void> {
  const olderRaw = parseArg('--older-than-days');
  const maxGbRaw = parseArg('--max-gb');
  const opts: { olderThanDays?: number; maxBytes?: number } = {};
  if (olderRaw !== undefined) opts.olderThanDays = Number(olderRaw);
  // Default to the 8 GB cap when no flag is given.
  opts.maxBytes = (maxGbRaw !== undefined ? Number(maxGbRaw) : CAP_BYTES / 1024 ** 3) * 1024 ** 3;
  const r = await pruneCache(CACHE_ROOT, opts);
  console.log(
    `pruned ${r.removedTiles} tiles, freed ${gb(r.removedBytes)}; now ${gb(r.totalBytesAfter)}`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'report') await report();
  else if (cmd === 'prune') await prune();
  else {
    console.error('usage: sat-cache <report|prune> [--older-than-days=N] [--max-gb=N]');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
