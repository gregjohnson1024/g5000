import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Characterization tests for the OSM tile proxy (/api/tiles).
 *
 * Pins the DISCRIMINATING behavior so the tile-proxy factory refactor
 * cannot silently flatten this route's quirks:
 *   - upstream is tile.openstreetmap.org, standard {z}/{x}/{y}.png order;
 *   - png content-type on HIT and MISS;
 *   - STRICT error policy: !r.ok 5xx -> 502 text body (NOT a transparent PNG);
 *     a fetch throw propagates out of GET (NOT swallowed into a TIMEOUT tile);
 *   - NO zoom band (no EMPTY response).
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
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-tiles-char-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('tiles (OSM) proxy — characterization', () => {
  it('MISS: fetches exact OSM url (standard z/x/y), png, x-cache=MISS, writes disk', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    const res = await GET(
      new Request('http://x/api/tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://tile.openstreetmap.org/12/1234/5678.png',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'tile-cache', '12', '1234', '5678.png'))).toBe(true);
  });

  it('HIT: serves cached bytes, png, x-cache=HIT, no fetch', async () => {
    const dir = join(TMP_ROOT, 'tile-cache', '12', '1234');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '5678.png'), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('STRICT 404: returns 404 text body, no disk write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nf', { status: 404 }));
    const res = await GET(
      new Request('http://x/api/tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(
      'upstream tile https://tile.openstreetmap.org/12/1234/5678.png → 404',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'tile-cache', '12', '1234', '5678.png'))).toBe(false);
  });

  it('STRICT 5xx: returns 502 (NOT a transparent PNG)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    const res = await GET(
      new Request('http://x/api/tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get('x-cache')).toBeNull();
    expect(await res.text()).toBe(
      'upstream tile https://tile.openstreetmap.org/12/1234/5678.png → 503',
    );
  });

  it('STRICT throw: a fetch rejection propagates out of GET (not swallowed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(
      GET(new Request('http://x/api/tiles/12/1234/5678'), makeCtx('12', '1234', '5678')),
    ).rejects.toThrow('network down');
  });

  it('rejects bad coords', async () => {
    const res = await GET(new Request('http://x/api/tiles/abc/1/1'), makeCtx('abc', '1', '1'));
    expect(res.status).toBe(400);
  });

  it('accepts a high zoom with no EMPTY band (z=19 still fetches)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([0x89]), { status: 200 }));
    const res = await GET(new Request('http://x/api/tiles/19/1/1'), makeCtx('19', '1', '1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves a non-canonical (leading-zero) z verbatim in the upstream url', async () => {
    // OSM/seamark embed the RAW z string — `08`, not `8`. Pins byte-identical
    // upstream URLs (the factory must NOT Number()-normalize z for these).
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([0x89]), { status: 200 }));
    await GET(new Request('http://x/api/tiles/08/1/2'), makeCtx('08', '1', '2'));
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://tile.openstreetmap.org/08/1/2.png');
  });
});
