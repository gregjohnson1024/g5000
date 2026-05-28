import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { ROOT } from '../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Precomputed global GEBCO depth-contour archive, produced by
// tools/gebco-contour-maker and pre-warmed into the router cache. Served
// same-origin so MapLibre's pmtiles:// protocol can read it with HTTP range
// requests.
//
// The archive IS rebuilt occasionally (re-running the pipeline drops a new file
// at the same path), so it must NOT be served `immutable`: a stale immutable
// cache mixes old and new byte ranges and corrupts pmtiles' offset math
// ("Failed to Decode Data"). We emit an ETag from size+mtime and let the
// browser revalidate on reload — still cached within max-age for offline use,
// but a reload after a rebuild refetches the changed bytes.
const FILE = join(ROOT, 'bathy-pmtiles', 'world.pmtiles');

function webStream(start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(FILE, { start, end })) as ReadableStream<Uint8Array>;
}

export function GET(req: Request): Response {
  let size: number;
  let mtimeMs: number;
  try {
    const st = statSync(FILE);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return new Response('bathy pmtiles not found', { status: 404 });
  }

  const etag = `"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;
  const base = {
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    // Cacheable for offline use, but revalidate on reload (NOT immutable) so a
    // rebuilt archive is picked up instead of a stale partial.
    'cache-control': 'public, max-age=31536000',
    etag,
  };

  // Cheap revalidation: client's cached copy is still current.
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: base });
  }

  const range = req.headers.get('range');
  // If the client's partial cache (If-Range) predates the current file, ignore
  // the range and return the whole new entity so it discards stale partials.
  const ifRange = req.headers.get('if-range');
  if (!range || (ifRange && ifRange !== etag)) {
    return new Response(webStream(0, size - 1), {
      status: 200,
      headers: { ...base, 'content-length': String(size) },
    });
  }

  // Parse `bytes=start-end`, `bytes=start-`, or suffix `bytes=-N`.
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response('invalid range', { status: 416, headers: base });
  }
  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix: last N bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { ...base, 'content-range': `bytes */${size}` },
    });
  }

  return new Response(webStream(start, end), {
    status: 206,
    headers: {
      ...base,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
    },
  });
}
