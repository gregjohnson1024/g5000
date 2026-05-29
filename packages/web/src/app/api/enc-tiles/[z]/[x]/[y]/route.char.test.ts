import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Characterization tests for the NOAA NCDS chart proxy (/api/enc-tiles).
 * Pins the DISCRIMINATING quirks the factory must preserve:
 *   - noaa_z = std_z - 2 AND ArcGIS row/col order /tile/{z}/{y}/{x};
 *   - disk cache key uses STANDARD z/x/y (not noaaZ);
 *   - png on HIT and MISS;
 *   - off-coverage zoom (outside std z 2..18) -> transparent 1x1 PNG,
 *     x-cache=EMPTY, max-age=2592000, NO fetch;
 *   - SOFT error policy: 5xx -> transparent PNG x-cache=UPSTREAM-5XX max-age=60;
 *     fetch throw -> transparent PNG x-cache=TIMEOUT max-age=60 (swallowed);
 *     404 -> 404 text body.
 */

let TMP_ROOT: string;
let GET: (
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) => Promise<Response>;

function makeCtx(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-enc-char-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('enc-tiles (NOAA) proxy — characterization', () => {
  it('MISS: noaa_z=z-2 and ArcGIS {z}/{y}/{x} order; disk key uses standard z/x/y', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    // std z=12 -> noaa z=10; x=1234,y=5678 -> upstream /tile/10/5678/1234
    const res = await GET(
      new Request('http://x/api/enc-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://gis.charttools.noaa.gov/arcgis/rest/services/' +
        'MarineChart_Services/NOAACharts/MapServer/tile/10/5678/1234',
    );
    await new Promise((r) => setTimeout(r, 50));
    // disk path keyed on STANDARD z/x/y
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '12', '1234', '5678.png'))).toBe(true);
  });

  it('HIT: serves cached bytes from standard-keyed path, png, x-cache=HIT, no fetch', async () => {
    const dir = join(TMP_ROOT, 'enc-cache', '12', '1234');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '5678.png'), Buffer.from([4, 5, 6]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/enc-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([4, 5, 6]);
  });

  it('off-coverage low zoom (z=1): transparent 1x1 PNG, x-cache=EMPTY, max-age=2592000, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(new Request('http://x/api/enc-tiles/1/0/0'), makeCtx('1', '0', '0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(67); // 67-byte transparent PNG
    expect(Array.from(body.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('off-coverage high zoom (z=19): EMPTY, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(new Request('http://x/api/enc-tiles/19/0/0'), makeCtx('19', '0', '0'));
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SOFT 5xx: transparent PNG, x-cache=UPSTREAM-5XX, max-age=60 (NOT 502)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await GET(
      new Request('http://x/api/enc-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('UPSTREAM-5XX');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(67);
  });

  it('SOFT throw: transparent PNG, x-cache=TIMEOUT, max-age=60 (swallowed, not propagated)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    const res = await GET(
      new Request('http://x/api/enc-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('TIMEOUT');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(67);
  });

  it('SOFT 404: 404 text body (the one strict-style branch), no disk write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nf', { status: 404 }));
    const res = await GET(
      new Request('http://x/api/enc-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(
      'upstream tile https://gis.charttools.noaa.gov/arcgis/rest/services/' +
        'MarineChart_Services/NOAACharts/MapServer/tile/10/5678/1234 → 404',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '12', '1234', '5678.png'))).toBe(false);
  });

  it('rejects bad coords', async () => {
    const res = await GET(new Request('http://x/api/enc-tiles/abc/1/1'), makeCtx('abc', '1', '1'));
    expect(res.status).toBe(400);
  });
});
