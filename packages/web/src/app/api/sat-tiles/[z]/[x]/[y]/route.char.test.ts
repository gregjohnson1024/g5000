import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Characterization tests for the Esri World Imagery satellite proxy
 * (/api/sat-tiles). Pins the quirks UNIQUE to sat that the factory must
 * preserve:
 *   - upstream Esri ArcGIS, STANDARD zoom (NO -2 offset) but ArcGIS
 *     row/col order /tile/{z}/{y}/{x};
 *   - .jpg extension on cache file + y-regex;
 *   - HIT content-type is HARDCODED image/jpeg;
 *   - MISS content-type is PASSTHROUGH from upstream (proven by feeding a
 *     non-jpeg upstream content-type and asserting it survives);
 *   - mtime BUMP on HIT (LRU last-served-time);
 *   - disk freshness TTL is 365d (a tile ~30d old is still a HIT);
 *   - SOFT error policy: 5xx -> UPSTREAM-5XX transparent PNG max-age=60;
 *     throw -> TIMEOUT transparent PNG max-age=60; 404 -> 404 text;
 *   - transparent / EMPTY bodies are image/png even though tiles are jpeg.
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
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-sat-char-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('sat-tiles (Esri) proxy — characterization', () => {
  it('MISS: standard z (no offset) + ArcGIS {z}/{y}/{x}; .jpg disk key; passthrough content-type', async () => {
    // Feed upstream content-type image/png to PROVE passthrough (not hardcoded jpeg).
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    // std z=12 stays 12; x=1234,y=5678 -> upstream /tile/12/5678/1234
    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    // PASSTHROUGH: upstream said png, response must be png (proves not hardcoded jpeg)
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/' +
        'World_Imagery/MapServer/tile/12/5678/1234',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'sat-cache', '12', '1234', '5678.jpg'))).toBe(true);
  });

  it('MISS: falls back to image/jpeg when upstream omits content-type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2]), { status: 200 }), // no content-type
    );
    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('HIT: hardcoded image/jpeg (NOT passthrough), serves cached bytes, no fetch', async () => {
    const dir = join(TMP_ROOT, 'sat-cache', '12', '1234');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '5678.jpg'), Buffer.from([9, 9, 9]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([9, 9, 9]);
  });

  it('HIT: bumps file mtime to ~now (LRU); a 30-day-old tile is still fresh (365d TTL)', async () => {
    const dir = join(TMP_ROOT, 'sat-cache', '12', '1234');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, '5678.jpg');
    writeFileSync(file, Buffer.from([9]));
    // Age the tile 30 days — well inside sat's 365d freshness window.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(file, thirtyDaysAgo, thirtyDaysAgo);
    const before = statSync(file).mtimeMs;

    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.headers.get('x-cache')).toBe('HIT'); // proves 30d old is still a HIT

    // mtime bump is fire-and-forget — flush a tick then re-stat.
    await new Promise((r) => setTimeout(r, 50));
    const after = statSync(file).mtimeMs;
    expect(after).toBeGreaterThan(before);
    expect(Math.abs(Date.now() - after)).toBeLessThan(5000);
  });

  it('off-coverage zoom: y-regex with .jpg suffix; out-of-band -> EMPTY transparent PNG', async () => {
    // sat band is 0..19; force out-of-band via a 2-digit zoom above MAX_Z.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(new Request('http://x/api/sat-tiles/20/0/0'), makeCtx('20', '0', '0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(res.headers.get('content-type')).toBe('image/png'); // EMPTY is png even for sat
    expect(res.headers.get('cache-control')).toBe('public, max-age=2592000');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(67);
  });

  it('SOFT 5xx: transparent PNG (image/png), x-cache=UPSTREAM-5XX, max-age=60', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('UPSTREAM-5XX');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(67);
  });

  it('SOFT throw: transparent PNG, x-cache=TIMEOUT, max-age=60 (swallowed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('TIMEOUT');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('SOFT 404: 404 text body, no disk write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nf', { status: 404 }));
    const res = await GET(
      new Request('http://x/api/sat-tiles/12/1234/5678'),
      makeCtx('12', '1234', '5678'),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(
      'upstream tile https://server.arcgisonline.com/ArcGIS/rest/services/' +
        'World_Imagery/MapServer/tile/12/5678/1234 → 404',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'sat-cache', '12', '1234', '5678.jpg'))).toBe(false);
  });

  it('rejects bad coords', async () => {
    const res = await GET(new Request('http://x/api/sat-tiles/abc/1/1'), makeCtx('abc', '1', '1'));
    expect(res.status).toBe(400);
  });
});
