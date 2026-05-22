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

function mockUpstream(featuresByLayer: Record<number, unknown[]>): ReturnType<typeof vi.spyOn> {
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
    const body = (await res.json()) as { type: string; features: { properties: { colourCode: number } }[] };
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
      const called = fetchSpy.mock.calls.some((c) => String(c[0]).includes(`/MapServer/${id}/query`));
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
});
