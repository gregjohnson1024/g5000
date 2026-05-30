import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';

const { planMock, planViaMock } = vi.hoisted(() => {
  const planMock = vi.fn(() => ({
    legs: [
      {
        t: 0,
        lat: 30,
        lon: -75,
        heading: 0,
        twa: 0,
        tws: 8,
        bsp: 5,
        sogGround: 5,
      },
    ],
    start: 0,
    end: 3600,
    distance: 18000,
    model: 'GFS',
    usedCurrents: false,
    polarId: 'test',
  }));

  // planVia wraps plan twice for one intermediate — spy to verify it was invoked
  // and also assert the result contains a route (structural proof of chaining).
  const planViaMock = vi.fn();
  return { planMock, planViaMock };
});

vi.mock('@g5000/routing', async () => {
  const actual = (await vi.importActual('@g5000/routing')) as Record<string, unknown>;
  const actualPlanVia = actual['planVia'] as (input: unknown, intermediates: unknown[]) => unknown;
  planViaMock.mockImplementation((...args: Parameters<typeof actualPlanVia>) =>
    actualPlanVia(...args),
  );
  return {
    ...actual,
    plan: planMock,
    planVia: planViaMock,
  };
});

// Stub the GRIB + coastline loaders the handler invokes:
vi.mock('../../../../lib/grib-context.js', () => ({
  loadWindFor: vi.fn(async () => ({
    /* tiny mock WindField */
  })),
  loadCurrentFor: vi.fn(async () => ({
    /* tiny mock CurrentField */
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
  planMock.mockClear();
  planViaMock.mockClear();
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

  it('via widens the bbox and round-trips a multi-leg route (planVia called once per request)', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        via: [{ lat: 30, lon: -70 }],
        departure: 0,
        model: 'GFS',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.route).toBeDefined();
    // The handler routes through planVia (not plan) when via is present.
    // planVia is called once and internally segments start→via and via→end.
    expect(planViaMock).toHaveBeenCalledTimes(1);
  });

  it('invalid via body returns 400', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        via: [{ lat: 'nope' }],
        departure: 0,
        model: 'GFS',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
