import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) => Promise<Response>;

function makeCtx(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-seamark-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('seamark-tiles route', () => {
  it('fetches from upstream on a cache miss and writes the tile to disk', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upstreamUrl = fetchSpy.mock.calls[0]?.[0];
    expect(String(upstreamUrl)).toBe('https://tiles.openseamap.org/seamark/12/1234/5678.png');

    // wait a tick for the best-effort disk write to flush
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(true);
  });

  it('serves from disk on a cache hit without calling fetch', async () => {
    const tileDir = join(TMP_ROOT, 'seamark-cache', '12', '1234');
    mkdirSync(tileDir, { recursive: true });
    writeFileSync(join(tileDir, '5678.png'), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3]);
  });

  it('does not cache when upstream returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(false);
  });

  it('rejects bad tile coords', async () => {
    const res = await GET(
      new Request('http://x/api/seamark-tiles/abc/1/1'),
      makeCtx('abc', '1', '1'),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a .png suffix on y', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89]), { status: 200 }),
    );
    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678.png'),
      makeCtx('12', '1234', '5678.png'),
    );
    expect(res.status).toBe(200);
  });
});
