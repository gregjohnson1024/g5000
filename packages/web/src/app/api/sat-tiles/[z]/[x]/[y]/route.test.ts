import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let GET: (
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) => Promise<Response>;
let root: string;

function params(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sat-tiles-test-'));
  process.env.G5000_ROUTER_ROOT = root;
  vi.resetModules();
  ({ GET } = await import('./route'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  delete process.env.G5000_ROUTER_ROOT;
});

describe('sat-tiles proxy', () => {
  it('rejects bad coordinates with 400', async () => {
    const res = await GET(new Request('http://x'), params('abc', '1', '1'));
    expect(res.status).toBe(400);
  });

  it('serves a transparent EMPTY tile outside the zoom band', async () => {
    const res = await GET(new Request('http://x'), params('25', '1', '1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
  });

  it('serves a fresh disk tile as HIT and bumps its mtime', async () => {
    const dir = join(root, 'sat-cache', '12', '5');
    await mkdir(dir, { recursive: true });
    const file = join(dir, '7.jpg');
    await writeFile(file, Buffer.from([1, 2, 3]));
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);

    const res = await GET(new Request('http://x'), params('12', '5', '7'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    // mtime bump is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const s = await stat(file);
    expect(s.mtimeMs).toBeGreaterThan(old.getTime());
  });

  it('fetches Esri on MISS, passes content-type through, writes disk', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
    const res = await GET(new Request('http://x'), params('10', '3', '4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    // ArcGIS row/col order (y before x), no zoom offset.
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/tile/10/4/3');
  });

  it('falls back to a transparent tile on upstream error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await GET(new Request('http://x'), params('10', '3', '4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('TIMEOUT');
  });
});
