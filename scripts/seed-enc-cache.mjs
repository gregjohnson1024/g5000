#!/usr/bin/env node
// Pre-warm the NOAA ENC tile disk cache by hammering our own proxy at
// /api/enc-tiles/{z}/{x}/{y}.png across a bbox + zoom range. The proxy
// writes every successful upstream response to ~/.g5000-router/enc-cache,
// so once this finishes the offshore boat has full coverage on disk.
//
// Usage:
//   node scripts/seed-enc-cache.mjs \
//     [--host http://localhost:3000] \
//     [--south 30] [--west -75] [--north 45] [--east -60] \
//     [--minz 2] [--maxz 12] \
//     [--concurrency 6]
//
// Defaults seed the Bermuda → Bristol RI passage corridor at z=2..12.
// Adding z=2..6 over a continental bbox is only ~100 extra tiles so the
// total is still dominated by z=11..12. Stops on Ctrl+C; re-running
// picks up where it left off (tiles already on disk return x-cache=HIT
// and don't trigger a fresh upstream fetch). To force a full re-pull,
// delete ~/.g5000-router/enc-cache/ first.

import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const HOST = args.host ?? 'http://localhost:3000';
const south = num(args.south, 30);
const west = num(args.west, -75);
const north = num(args.north, 45);
const east = num(args.east, -60);
const minz = int(args.minz, 2);
const maxz = int(args.maxz, 12);
const concurrency = int(args.concurrency, 6);

if (south >= north || west >= east) {
  console.error('bad bbox: need south < north and west < east');
  process.exit(2);
}
if (minz < 2 || maxz > 18 || minz > maxz) {
  console.error('bad zoom range: NOAA covers z=2..18 (default 2..12)');
  process.exit(2);
}

const tiles = enumerate({ south, west, north, east }, minz, maxz);
console.log(
  `seed: ${tiles.length} tiles, bbox=[${south},${west} → ${north},${east}], z=${minz}..${maxz}, concurrency=${concurrency}`,
);

let done = 0;
let hits = 0;
let misses = 0;
let timeouts = 0;
let empties = 0;
let errors = 0;
const startMs = Date.now();

const queue = tiles.slice();

async function worker() {
  while (queue.length) {
    const t = queue.shift();
    if (!t) break;
    try {
      const url = `${HOST}/api/enc-tiles/${t.z}/${t.x}/${t.y}.png`;
      const res = await fetch(url);
      const cache = res.headers.get('x-cache') ?? '';
      if (cache === 'HIT') hits++;
      else if (cache === 'TIMEOUT') timeouts++;
      else if (cache === 'EMPTY') empties++;
      else misses++;
    } catch {
      errors++;
    }
    done++;
    if (done % 50 === 0 || done === tiles.length) report();
  }
}

function report() {
  const elapsedS = (Date.now() - startMs) / 1000;
  const rate = done / elapsedS;
  const remaining = tiles.length - done;
  const etaS = rate > 0 ? remaining / rate : 0;
  const pct = ((done / tiles.length) * 100).toFixed(1);
  console.log(
    `  ${done}/${tiles.length} (${pct}%)  hit=${hits} miss=${misses} timeout=${timeouts} empty=${empties} err=${errors}  ${rate.toFixed(1)}/s  eta=${humanT(etaS)}`,
  );
}

const pool = Array.from({ length: concurrency }, () => worker());
await Promise.all(pool);
report();
console.log('done.');

// ----- helpers -----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const peek = argv[i + 1];
    if (peek && !peek.startsWith('--')) {
      out[key] = peek;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function num(v, dflt) {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`not a number: ${v}`);
  return n;
}

function int(v, dflt) {
  return Math.trunc(num(v, dflt));
}

// Standard XYZ tile math. NOAA's grid is offset (`noaa_z = z - 2`) and the
// proxy handles that translation server-side, so we feed it standard z/x/y.
function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

function enumerate(bbox, minz, maxz) {
  const out = [];
  for (let z = minz; z <= maxz; z++) {
    const x0 = lon2tile(bbox.west, z);
    const x1 = lon2tile(bbox.east, z);
    // tile y grows southward — north has lower y
    const y0 = lat2tile(bbox.north, z);
    const y1 = lat2tile(bbox.south, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        out.push({ z, x, y });
      }
    }
  }
  return out;
}

function humanT(s) {
  if (!Number.isFinite(s) || s <= 0) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
