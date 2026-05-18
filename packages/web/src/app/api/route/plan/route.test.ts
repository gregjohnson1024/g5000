import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';

// The mock honors the `crossover` input: when a map is provided, it decorates
// the (single) returned leg with the configId from cell '0,0'. This lets us
// drive computeSailTimeline from the test by painting that cell.
vi.mock('@g5000/routing', async () => {
  const actual = (await vi.importActual('@g5000/routing')) as Record<string, unknown>;
  return {
    ...actual,
    plan: vi.fn((input: { crossover?: { map: { cells: Record<string, string> } } }) => {
      const configId = input.crossover?.map.cells['0,0'];
      const leg: Record<string, unknown> = {
        t: 0,
        lat: 30,
        lon: -75,
        heading: 0,
        twa: 0,
        tws: 8,
        bsp: 5,
        sogGround: 5,
      };
      if (configId) leg.configId = configId;
      return {
        legs: [leg],
        start: 0,
        end: 3600,
        distance: 18000,
        model: 'GFS',
        usedCurrents: false,
        polarId: 'test',
      };
    }),
  };
});

// Stub the GRIB + coastline loaders the handler invokes:
vi.mock('../../../../lib/grib-context.js', () => ({
  loadWindFor: vi.fn(async () => ({
    /* tiny mock WindField */
  })),
}));
vi.mock('../../../../lib/coastline.js', () => ({
  loadDefaultCoastline: vi.fn(async () => ({})),
}));

import { POST } from './route';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/route-plan-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('POST /api/route/plan', () => {
  it('returns a Route for a well-formed body', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        departure: 0,
        model: 'GFS',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.route.model).toBe('GFS');
  });

  it('returns 400 for missing fields', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe('bad_request');
  });

  it('passes the crossover map+wardrobe to plan() and returns sailTimeline', async () => {
    // Paint cell 0,0 → 'jib'. The mocked plan() will decorate its single leg
    // with configId='jib', which computeSailTimeline collapses into one segment.
    await store.setCrossoverMap({
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '0,0': 'jib' },
      updatedAt: 0,
    });

    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        departure: 0,
        model: 'GFS',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.route.sailTimeline)).toBe(true);

    // Verify plan() was called with crossover input.
    const { plan } = (await import('@g5000/routing')) as unknown as {
      plan: { mock: { calls: Array<Array<Record<string, unknown>>> } };
    };
    const lastCall = plan.mock.calls[plan.mock.calls.length - 1]?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall?.crossover).toBeDefined();
    expect(
      (lastCall?.crossover as { map: { cells: Record<string, string> } }).map.cells['0,0'],
    ).toBe('jib');
    expect((lastCall?.crossover as { wardrobe: { boatId: string } }).wardrobe.boatId).toBe(
      store.activeBoatId,
    );

    // The decorated leg should surface as a sailTimeline segment.
    expect(body.route.sailTimeline.length).toBeGreaterThan(0);
    expect(body.route.sailTimeline[0].configId).toBe('jib');
  });

  it('returns an empty sailTimeline when no crossover cells match', async () => {
    // Default crossover map has no cells painted, so the mocked plan() leaves
    // its leg unconfigured and computeSailTimeline returns [].
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        departure: 0,
        model: 'GFS',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.route.sailTimeline)).toBe(true);
    expect(body.route.sailTimeline).toEqual([]);
  });
});
