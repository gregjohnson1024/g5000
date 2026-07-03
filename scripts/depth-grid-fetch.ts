/**
 * Fetch a bbox subset of NOAA ETOPO 2022 (15 arc-second bedrock elevation)
 * and tile it into the depth-grid store the router's draft constraint reads
 * (`~/.g5000-router/depth-grid/manifest.json` + one Int16 .bin per tile —
 * see packages/web/src/lib/depth-grid.ts for the format).
 *
 * SHORE-RUN ONLY: this hits NOAA's ERDDAP griddap endpoint over the
 * internet — run it on shore wifi to pre-warm the cache before going
 * offshore, like the sat/GRIB seeders. It has NOT been network-verified from
 * this machine; if NOAA moves the dataset, pass --url with the current
 * griddap dataset base (any ERDDAP serving ETOPO 2022 bedrock with variable
 * `z(latitude, longitude)` works — see griddapCsvUrl for the subset form).
 *
 *   npx tsx scripts/depth-grid-fetch.ts --bbox 41,-72,42,-70          # Narragansett-ish
 *   npx tsx scripts/depth-grid-fetch.ts --bbox 30,-70,33,-64 --res 60
 *
 * Args:
 *   --bbox latMin,lonMin,latMax,lonMax   (required)
 *   --res N        arc-seconds, multiple of 15 (default 15 = native)
 *   --url BASE     ERDDAP griddap dataset base URL (no .csv suffix)
 *
 * Resilient: the bbox is fetched in 1°×1° chunks, each retried with backoff;
 * a failed chunk is reported and skipped so a flaky connection still leaves
 * partial coverage on disk (rerun to fill gaps — the manifest merges by
 * tile name).
 */
import { DEPTH_GRID_DIR, writeDepthGrid } from '../packages/web/src/lib/depth-grid';
import {
  DEFAULT_ETOPO_URL,
  elevGridToDepthTile,
  fetchElevChunk,
} from '../packages/web/src/lib/depth-grid-fetch';

interface Args {
  bbox: [number, number, number, number]; // latMin, lonMin, latMax, lonMax
  res: number;
  url: string;
}

function parseArgs(argv: string[]): Args {
  let bbox: Args['bbox'] | null = null;
  let res = 15;
  let url = DEFAULT_ETOPO_URL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--bbox') {
      const parts = next().split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error('--bbox wants latMin,lonMin,latMax,lonMax');
      }
      bbox = parts as Args['bbox'];
    } else if (a === '--res') {
      res = Number(next());
    } else if (a === '--url') {
      url = next();
    } else {
      throw new Error(`unknown arg ${a}`);
    }
  }
  if (!bbox) throw new Error('--bbox is required (latMin,lonMin,latMax,lonMax)');
  const [latMin, lonMin, latMax, lonMax] = bbox;
  if (latMin >= latMax || lonMin >= lonMax) throw new Error('--bbox min must be < max');
  if (res < 15 || res % 15 !== 0) throw new Error('--res must be a multiple of 15 arc-seconds');
  return { bbox, res, url };
}

async function main(): Promise<void> {
  const { bbox, res, url } = parseArgs(process.argv.slice(2));
  const [latMin, lonMin, latMax, lonMax] = bbox;
  console.log(
    `depth-grid fetch: bbox ${latMin},${lonMin} → ${latMax},${lonMax} @ ${res}" from ${url}`,
  );
  console.log(`writing to ${DEPTH_GRID_DIR}`);

  let ok = 0;
  let failed = 0;
  for (let la = Math.floor(latMin); la < latMax; la++) {
    for (let lo = Math.floor(lonMin); lo < lonMax; lo++) {
      const cLatMin = Math.max(la, latMin);
      const cLatMax = Math.min(la + 1, latMax);
      const cLonMin = Math.max(lo, lonMin);
      const cLonMax = Math.min(lo + 1, lonMax);
      const name = `etopo_${res}s_${cLatMin}_${cLonMin}`;
      try {
        const grid = await fetchElevChunk(url, cLatMin, cLatMax, cLonMin, cLonMax, res, (u) =>
          fetch(u),
        );
        const tile = elevGridToDepthTile(grid, name);
        await writeDepthGrid(DEPTH_GRID_DIR, res, [tile]);
        ok++;
        console.log(`  ✓ ${name} (${tile.meta.rows}×${tile.meta.cols})`);
      } catch (err) {
        failed++;
        console.error(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log(
    `done: ${ok} tiles written, ${failed} failed${failed ? ' — rerun to fill gaps' : ''}`,
  );
  if (ok === 0 && failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
