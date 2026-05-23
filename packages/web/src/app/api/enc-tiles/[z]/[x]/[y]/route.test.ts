import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) => Promise<Response>;

function makeCtx(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-enc-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('enc-tiles route', () => {
  it('translates std XYZ to NOAA z-2 with ArcGIS y/x order on cache miss', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upstreamUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(upstreamUrl).toBe(
      'https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/tile/13/12226/9892',
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '15', '9892', '12226.png'))).toBe(true);
  });

  it('serves from disk on a cache hit without calling fetch', async () => {
    const tileDir = join(TMP_ROOT, 'enc-cache', '15', '9892');
    mkdirSync(tileDir, { recursive: true });
    writeFileSync(join(tileDir, '12226.png'), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
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
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
    );
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '15', '9892', '12226.png'))).toBe(false);
  });

  it('maps upstream 5xx to transparent PNG with no disk write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad gateway', { status: 502 }));
    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY-UPSTREAM-5XX');
    expect(res.headers.get('content-type')).toBe('image/png');
    const body = new Uint8Array(await res.arrayBuffer());
    // PNG signature
    expect(Array.from(body.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '15', '9892', '12226.png'))).toBe(false);
  });

  it('returns transparent 1x1 PNG with x-cache EMPTY for z<2', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(
      new Request('http://x/api/enc-tiles/1/0/0'),
      makeCtx('1', '0', '0'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    // PNG signature
    expect(Array.from(body.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('returns transparent 1x1 PNG for z>18', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(
      new Request('http://x/api/enc-tiles/19/0/0'),
      makeCtx('19', '0', '0'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects bad tile coords with 400', async () => {
    const res = await GET(
      new Request('http://x/api/enc-tiles/abc/1/1'),
      makeCtx('abc', '1', '1'),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a .png suffix on y', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89]), { status: 200 }),
    );
    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226.png'),
      makeCtx('15', '9892', '12226.png'),
    );
    expect(res.status).toBe(200);
  });
});
