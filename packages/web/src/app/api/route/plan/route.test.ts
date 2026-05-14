import { describe, it, expect, vi } from 'vitest';

vi.mock('@g5000/routing', async () => ({
  ...(await vi.importActual('@g5000/routing')),
  plan: vi.fn(() => ({
    legs: [{ t: 0, lat: 30, lon: -75, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 }],
    start: 0,
    end: 3600,
    distance: 18000,
    model: 'GFS',
    usedCurrents: false,
    polarId: 'test',
  })),
}));

// Stub the GRIB + coastline loaders the handler invokes:
vi.mock('../../../../lib/grib-context.js', () => ({
  loadWindFor: vi.fn(async () => ({ /* tiny mock WindField */ })),
}));
vi.mock('../../../../lib/coastline.js', () => ({
  loadDefaultCoastline: vi.fn(async () => ({})),
}));

import { POST } from './route';

describe('POST /api/route/plan', () => {
  it('returns a Route for a well-formed body', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        departure: 0,
        model: 'GFS',
        polar: { twsBins: [], twaBins: [], boatSpeed: [] },
        polarId: 'test',
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
});
