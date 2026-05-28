import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { ROOT } from '../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Precomputed global GEBCO depth-contour archive, produced by
// tools/gebco-contour-maker and pre-warmed into the router cache. Served
// same-origin so MapLibre's pmtiles:// protocol can read it with HTTP range
// requests. Bathymetry is static, so the file never changes underneath us.
const FILE = join(ROOT, 'bathy-pmtiles', 'world.pmtiles');

function webStream(start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(FILE, { start, end })) as ReadableStream<Uint8Array>;
}

export function GET(req: Request): Response {
  let size: number;
  try {
    size = statSync(FILE).size;
  } catch {
    return new Response('bathy pmtiles not found', { status: 404 });
  }

  const base = {
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
  };

  const range = req.headers.get('range');
  if (!range) {
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
