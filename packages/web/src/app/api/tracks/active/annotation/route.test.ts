import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: () => Promise<Response>;
let POST: (req: Request) => Promise<Response>;
let createTrack: (label?: string) => Promise<{ id: string }>;
let interruptActive: (label?: string) => Promise<{ id: string }>;

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-track-ann-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  const route = (await import('./route')) as {
    GET: () => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  };
  GET = route.GET;
  POST = route.POST;
  const tracks = await import('../../../../../lib/tracks');
  createTrack = tracks.createTrack;
  interruptActive = tracks.interruptActive;
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('GET /api/tracks/active/annotation', () => {
  it('returns trackId=null and empty annotations when no active track exists', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackId: string | null; annotations: unknown[] };
    expect(body.trackId).toBeNull();
    expect(body.annotations).toEqual([]);
  });

  it('returns the active track id and its annotations', async () => {
    const t = await createTrack('test');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackId: string; annotations: unknown[] };
    expect(body.trackId).toBe(t.id);
    expect(body.annotations).toEqual([]);
  });
});

describe('POST /api/tracks/active/annotation', () => {
  it('appends an event annotation and returns the updated list', async () => {
    const t = await createTrack('test');
    const before = Date.now();
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trackId: string;
      annotations: Array<{ tsMs: number; label: string; kind: string }>;
    };
    expect(body.trackId).toBe(t.id);
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0]?.label).toBe('Tack');
    expect(body.annotations[0]?.kind).toBe('event');
    expect(body.annotations[0]?.tsMs).toBeGreaterThanOrEqual(before);
    expect(body.annotations[0]?.tsMs).toBeLessThanOrEqual(after);
  });

  it('returns 404 when no active track exists', async () => {
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing label', async () => {
    await createTrack('test');
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'event' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid kind', async () => {
    await createTrack('test');
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'whatever' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('preserves earlier annotations when appending', async () => {
    await createTrack('test');
    await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Start period', kind: 'periodStart' }),
      }),
    );
    const body = (await res.json()) as {
      annotations: Array<{ label: string; kind: string }>;
    };
    expect(body.annotations.map((a) => a.label)).toEqual(['Tack', 'Start period']);
    expect(body.annotations.map((a) => a.kind)).toEqual(['event', 'periodStart']);
  });
});
