import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Characterization tests for the OpenSeaMap seamark tile proxy
 * (/api/seamark-tiles). Pins the DISCRIMINATING behavior alongside the
 * existing route.test.ts so the factory refactor cannot flatten quirks:
 *   - upstream is tiles.openseamap.org/seamark, standard {z}/{x}/{y}.png;
 *   - png on HIT and MISS;
 *   - STRICT error policy: 5xx -> 502 text (NOT transparent PNG);
 *     a fetch throw propagates out of GET.
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
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-seamark-char-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('seamark-tiles proxy — characterization', () => {
  it('MISS: exact openseamap url, png, x-cache=MISS, writes disk', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://tiles.openseamap.org/seamark/12/1234/5678.png',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(true);
  });

  it('HIT: serves cached bytes, png, x-cache=HIT, no fetch', async () => {
    const dir = join(TMP_ROOT, 'seamark-cache', '12', '1234');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '5678.png'), Buffer.from([7, 8, 9]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it('STRICT 404: 404 text body, no disk write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nf', { status: 404 }));
    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(
      'upstream tile https://tiles.openseamap.org/seamark/12/1234/5678.png → 404',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(false);
  });

  it('STRICT 5xx: 502 (NOT transparent PNG)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await GET(
      new Request('http://x/api/seamark-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get('x-cache')).toBeNull();
  });

  it('STRICT throw: fetch rejection propagates out of GET', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(
      GET(new Request('http://x/api/seamark-tiles/12/1234/5678'), makeCtx('12', '1234', '5678')),
    ).rejects.toThrow('network down');
  });

  it('rejects bad coords', async () => {
    const res = await GET(
      new Request('http://x/api/seamark-tiles/abc/1/1'),
      makeCtx('abc', '1', '1'),
    );
    expect(res.status).toBe(400);
  });
});
