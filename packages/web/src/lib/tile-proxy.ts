import { mkdir, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from './paths';

/**
 * Same-origin raster tile-proxy factory.
 *
 * The chart page (`/chart`) stacks several raster overlays, each served
 * through a same-origin proxy at `/api/<kind>-tiles/{z}/{x}/{y}` so the
 * MapLibre style can point at a same-origin URL and the tiles can be
 * cached on disk for offline use. The four proxies (OSM basemap,
 * OpenSeaMap seamarks, NOAA NCDS charts, Esri satellite) are near
 * identical: regex-validate z/x/y, serve from disk if fresh, otherwise
 * fetch upstream, write to disk best-effort, stream the response, with
 * `x-cache: HIT | MISS | EMPTY` and a transparent 1x1 PNG for
 * off-coverage zooms. This factory unifies them; each route supplies
 * only its distinguishing options.
 *
 * INVARIANTS (hardcoded — every proxy shares them, do not parameterize):
 *   - User-Agent string (OSM tile usage policy requires a descriptive UA).
 *   - The 67-byte transparent 1x1 PNG used for EMPTY/soft-error responses.
 *     It is ALWAYS `image/png`, even for the JPEG satellite proxy.
 *   - The browser-side `cache-control` on HIT/MISS is `max-age=2592000`
 *     (30 days) for all four. This is SEPARATE from the on-disk freshness
 *     TTL (`maxAgeMs`), which is 30 d for most but 365 d for satellite.
 *   - `access-control-allow-origin: *` on every response.
 *   - Disk cache key always uses the STANDARD incoming z/x/y. Only
 *     `upstreamUrl` applies any zoom-offset / row-col reordering.
 */

const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const HIT_MISS_CACHE_CONTROL = 'public, max-age=2592000';

// 67-byte fully-transparent 1x1 PNG. Pre-encoded so we never re-encode at
// request time. Used for EMPTY (off-coverage zoom) and the soft error
// policy's TIMEOUT / UPSTREAM-5XX placeholders. Always served as image/png.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export interface TileProxyOptions {
  /** Cache subdirectory under `ROOT` (e.g. 'tile-cache', 'sat-cache'). */
  cacheSubdir: string;
  /** File extension WITHOUT the dot, e.g. 'png' or 'jpg'. */
  ext: 'png' | 'jpg';
  /**
   * Content-type for HIT (cached) responses and the default for MISS when
   * the route does not pass upstream's content-type through.
   */
  contentType: string;
  /**
   * When true (satellite only), a MISS passes upstream's `content-type`
   * through (falling back to `contentType` if upstream omits it). When
   * false, MISS always uses `contentType`.
   */
  passthroughMiss?: boolean;
  /**
   * Builds the upstream URL from the STANDARD z/x/y (encodes any offset /
   * reorder). `z` is the RAW string param: the OSM/seamark proxies embed it
   * verbatim (so a non-canonical zoom like `08` is preserved byte-for-byte),
   * while the NOAA/Esri builders apply `Number(z)` themselves for the offset.
   */
  upstreamUrl: (z: string, x: string, y: string) => string;
  /** On-disk freshness TTL in ms. Stale disk tiles are re-fetched. */
  maxAgeMs: number;
  /** Optional inclusive zoom band; outside it we serve EMPTY (no fetch). */
  zoomBand?: { min: number; max: number };
  /**
   * Upstream error handling:
   *   - 'strict' (OSM, seamark): fetch is NOT guarded — a network throw
   *     propagates out; `!r.ok` returns 404 (text) or 502 (text). 15 s timeout.
   *   - 'soft' (NOAA, sat): fetch IS guarded — a throw returns a transparent
   *     PNG (x-cache=TIMEOUT, max-age=60); `!r.ok` returns 404 (text) for 404
   *     or a transparent PNG (x-cache=UPSTREAM-5XX, max-age=60) otherwise.
   *     25 s timeout.
   */
  errorPolicy: 'strict' | 'soft';
  /** fetch() AbortSignal timeout in ms (15_000 strict, 25_000 soft). */
  timeoutMs: number;
  /** When true (satellite only), bump the cached file's mtime on HIT (LRU). */
  bumpMtimeOnHit?: boolean;
}

type GetHandler = (
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) => Promise<Response>;

function stripExt(y: string, ext: string): string {
  return y.replace(new RegExp(`\\.${ext}$`), '');
}

function tilePath(opts: TileProxyOptions, z: string, x: string, y: string): string {
  const yBase = stripExt(y, opts.ext);
  return join(ROOT, opts.cacheSubdir, z, x, `${yBase}.${opts.ext}`);
}

function emptyResponse(): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': HIT_MISS_CACHE_CONTROL,
      'x-cache': 'EMPTY',
      'access-control-allow-origin': '*',
    },
  });
}

function transparentSoft(xCache: string): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60',
      'x-cache': xCache,
      'access-control-allow-origin': '*',
    },
  });
}

async function serveFromDisk(opts: TileProxyOptions, path: string): Promise<Response | null> {
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs > opts.maxAgeMs) return null;
    const buf = await readFile(path);
    if (opts.bumpMtimeOnHit) {
      // Bump mtime → last-served time (LRU). Fire-and-forget; never block.
      const now = new Date();
      void utimes(path, now, now).catch(() => {});
    }
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': opts.contentType,
        'cache-control': HIT_MISS_CACHE_CONTROL,
        'x-cache': 'HIT',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return null;
  }
}

async function fetchAndCache(
  opts: TileProxyOptions,
  z: string,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = stripExt(y, opts.ext);
  const url = opts.upstreamUrl(z, x, yBase);

  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    // strict: propagate the throw out of GET. soft: transparent placeholder.
    if (opts.errorPolicy === 'strict') throw err;
    return transparentSoft('TIMEOUT');
  }

  if (!r.ok) {
    if (r.status === 404) {
      // Both policies surface a 404 as a 404 text body (no disk write).
      return new Response(`upstream tile ${url} → 404`, {
        status: 404,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    if (opts.errorPolicy === 'soft') {
      return transparentSoft('UPSTREAM-5XX');
    }
    // strict: any non-404, non-ok upstream → 502 text body.
    return new Response(`upstream tile ${url} → ${r.status}`, {
      status: 502,
      headers: { 'access-control-allow-origin': '*' },
    });
  }

  const contentType = opts.passthroughMiss
    ? (r.headers.get('content-type') ?? opts.contentType)
    : opts.contentType;
  const buf = Buffer.from(await r.arrayBuffer());
  // Best-effort write; if disk is full or permissions block us we still
  // serve the body. Misses just become more expensive, not broken.
  void (async () => {
    try {
      await mkdir(dirname(diskPath), { recursive: true });
      await writeFile(diskPath, buf);
    } catch {
      /* ignore — serving the response is more important than caching */
    }
  })();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': HIT_MISS_CACHE_CONTROL,
      'x-cache': 'MISS',
      'access-control-allow-origin': '*',
    },
  });
}

/**
 * Build a Next.js App Router GET handler for a same-origin tile proxy.
 * Each route.ts supplies its `opts` and re-exports `dynamic`/`runtime`
 * statically (Next reads those at build time; a factory cannot provide them).
 */
export function tileProxy(opts: TileProxyOptions): GetHandler {
  const yPattern = new RegExp(`^\\d{1,7}(\\.${opts.ext})?$`);
  return async function GET(_req, ctx) {
    const { z, x, y } = await ctx.params;
    if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !yPattern.test(y)) {
      return new Response('bad tile coords', {
        status: 400,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    const zNum = Number(z);
    if (opts.zoomBand && (zNum < opts.zoomBand.min || zNum > opts.zoomBand.max)) {
      return emptyResponse();
    }
    const path = tilePath(opts, z, x, y);
    const fromDisk = await serveFromDisk(opts, path);
    if (fromDisk) return fromDisk;
    return fetchAndCache(opts, z, x, y, path);
  };
}
