import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let GET: (req: Request) => Promise<Response>;

const BUOY_LAYER_IDS = [4, 5, 6, 7];

function makeFeature(id: number, lon: number, lat: number, colour: string): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { OBJECTID: id, OBJL: 17, BOYSHP: 4, COLOUR: colour, OBJNAM: `buoy-${id}` },
  };
}

function mockUpstream(featuresByLayer: Record<number, unknown[]>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const layerMatch = url.match(/\/encdirect\/enc_coastal\/MapServer\/(\d+)\/query/);
    if (!layerMatch) throw new Error(`unexpected upstream URL ${url}`);
    const layerId = Number(layerMatch[1]);
    const features = featuresByLayer[layerId] ?? [];
    return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enc-features route — happy path', () => {
  it('merges features from all four Coastal buoy layers', async () => {
    const fetchSpy = mockUpstream({
      4: [makeFeature(40, -71.4, 41.4, '3,1,3')], // isolated danger
      5: [makeFeature(50, -71.45, 41.45, '3'), makeFeature(51, -71.46, 41.46, '4')], // lateral
      6: [makeFeature(60, -71.5, 41.5, '3,1')], // safe water
      7: [makeFeature(70, -71.3, 41.3, '6')], // special purpose
    });

    const res = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/geo\+json|application\/json/);
    const body = (await res.json()) as {
      type: string;
      features: { properties: { colourCode: number } }[];
    };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Each feature carries a numeric colourCode derived from COLOUR.
    const codes = body.features.map((f) => f.properties.colourCode).sort();
    expect(codes).toEqual([3, 3, 3, 4, 6]);

    // Verify each upstream URL contains the bbox and key query params.
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      // URLSearchParams encodes commas as %2C; assert against the encoded form.
      expect(url).toContain('geometry=-71.5%2C41.3%2C-71.2%2C41.6');
      expect(url).toContain('inSR=4326');
      expect(url).toContain('outSR=4326');
      expect(url).toContain('f=geojson');
      expect(url).toContain('geometryType=esriGeometryEnvelope');
    }

    // All four layers were queried with the same bbox.
    for (const id of BUOY_LAYER_IDS) {
      const called = fetchSpy.mock.calls.some((c) =>
        String(c[0]).includes(`/MapServer/${id}/query`),
      );
      expect(called, `layer ${id} should be queried`).toBe(true);
    }
  });

  it('handles a layer that returns zero features (still merges others)', async () => {
    const fetchSpy = mockUpstream({
      4: [makeFeature(40, -71.4, 41.4, '3,1,3')],
      5: [makeFeature(50, -71.45, 41.45, '3')],
      6: [], // safe-water layer is empty for this bbox
      7: [makeFeature(70, -71.3, 41.3, '6')],
    });

    const res = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; features: unknown[] };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // still all four layers queried
  });

  it('serves a cache hit without hitting upstream on a repeat request', async () => {
    const fetchSpy = mockUpstream({ 4: [], 5: [], 6: [], 7: [] });

    const req = () =>
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6');

    const first = await GET(req());
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 4 layers

    fetchSpy.mockClear();
    const second = await GET(req());
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the same cache entry for slightly-different bboxes that quantise the same', async () => {
    const fetchSpy = mockUpstream({ 4: [], 5: [], 6: [], 7: [] });

    const first = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );
    expect(first.headers.get('x-cache')).toBe('MISS');
    fetchSpy.mockClear();

    // Same 0.1° quantised bounds (lonMin floors to -71.5, latMin floors to 41.3,
    // lonMax ceils to -71.2, latMax ceils to 41.6).
    const second = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.49,41.31,-71.21,41.59'),
    );
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('enc-features route — validation and errors', () => {
  it('returns 400 for an unknown class', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(
      new Request('http://x/api/enc-features?class=lights&bbox=-71.5,41.3,-71.2,41.6'),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or malformed bbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res1 = await GET(new Request('http://x/api/enc-features?class=buoys'));
    expect(res1.status).toBe(400);
    const res2 = await GET(new Request('http://x/api/enc-features?class=buoys&bbox=garbage'));
    expect(res2.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 502 when any upstream layer fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Layer 5 fails; others succeed empty.
      if (url.includes('/MapServer/5/')) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );
    expect(res.status).toBe(502);
  });
});
