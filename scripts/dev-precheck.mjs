#!/usr/bin/env node
// Auto-clear packages/web/.next when it bloats past the threshold.
// A stale dev cache past ~500 MB pushes Node's RSS + OS page cache
// into swap thrash on machines with limited RAM, manifesting as
// "node pegs 400% CPU and crashes my machine" at dev startup.
//
// Tunable via G5000_NEXT_CACHE_MAX_MB (default 500). Set to 0 to disable.

import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEXT_DIR = join(__dirname, '..', 'packages', 'web', '.next');
const THRESHOLD_MB = Number(process.env.G5000_NEXT_CACHE_MAX_MB ?? 500);

if (THRESHOLD_MB <= 0) process.exit(0);

function dirSizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else if (entry.isFile()) {
      try {
        total += statSync(p).size;
      } catch {
        /* ignore — file vanished mid-scan */
      }
    }
  }
  return total;
}

const bytes = dirSizeBytes(NEXT_DIR);
if (bytes === 0) process.exit(0);

const mb = Math.round(bytes / 1e6);
if (mb >= THRESHOLD_MB) {
  console.warn(
    `[dev-precheck] packages/web/.next is ${mb} MB (threshold ${THRESHOLD_MB} MB) — clearing to avoid dev-startup memory pressure.`,
  );
  rmSync(NEXT_DIR, { recursive: true, force: true });
  console.warn(`[dev-precheck] cleared.`);
}
