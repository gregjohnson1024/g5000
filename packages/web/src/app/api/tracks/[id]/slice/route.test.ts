import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

let createTrack: (label?: string) => Promise<{ id: string }>;
let appendPoint: (
  id: string,
  pt: { t: number; lat: number; lon: number },
) => Promise<unknown>;
let appendAnnotation: (
  id: string,
  ann: { tsMs: number; label: string; kind: 'event' | 'periodStart' | 'periodEnd' },
) => Promise<unknown>;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-slice-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  const route = (await import('./route')) as {
    GET: typeof GET;
  };
  GET = route.GET;
  const tracks = await import('../../../../../lib/tracks');
  createTrack = tracks.createTrack;
  appendPoint = tracks.appendPoint;
  appendAnnotation = tracks.appendAnnotation;
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('GET /api/tracks/[id]/slice', () => {
  it('returns inclusive points within [from, to] (points are in seconds; range is ms)', async () => {
    const t = await createTrack('test');
    await appendPoint(t.id, { t: 100, lat: 1, lon: 1 });
    await appendPoint(t.id, { t: 200, lat: 2, lon: 2 });
    await appendPoint(t.id, { t: 300, lat: 3, lon: 3 });
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=200000&to=300000`),
      ctx(t.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: Array<{ t: number }>;
      annotations: unknown[];
    };
    expect(body.points.map((p) => p.t)).toEqual([200, 300]);
    expect(body.annotations).toEqual([]);
  });

  it('returns inclusive annotations within [from, to]', async () => {
    const t = await createTrack('test');
    await appendAnnotation(t.id, { tsMs: 100_000, label: 'a', kind: 'event' });
    await appendAnnotation(t.id, { tsMs: 200_000, label: 'b', kind: 'event' });
    await appendAnnotation(t.id, { tsMs: 300_000, label: 'c', kind: 'event' });
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=200000&to=300000`),
      ctx(t.id),
    );
    const body = (await res.json()) as {
      annotations: Array<{ label: string }>;
    };
    expect(body.annotations.map((a) => a.label)).toEqual(['b', 'c']);
  });

  it('returns empty arrays when from > to', async () => {
    const t = await createTrack('test');
    await appendPoint(t.id, { t: 100, lat: 1, lon: 1 });
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=500000&to=100000`),
      ctx(t.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: unknown[];
      annotations: unknown[];
    };
    expect(body.points).toEqual([]);
    expect(body.annotations).toEqual([]);
  });

  it('returns 400 when from is missing', async () => {
    const t = await createTrack('test');
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?to=100000`),
      ctx(t.id),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when from is non-numeric', async () => {
    const t = await createTrack('test');
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=notanumber&to=100000`),
      ctx(t.id),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the track does not exist', async () => {
    const res = await GET(
      new Request(`http://x/api/tracks/track-999/slice?from=0&to=100000`),
      ctx('track-999'),
    );
    expect(res.status).toBe(404);
  });
});
