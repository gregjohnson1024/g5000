/**
 * Tests for /api/settings — verifies GET/PUT/PATCH contract.
 *
 * PATCH is the key addition: it must merge at the top-level key granularity
 * without clobbering keys owned by other clients.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Each test gets its own isolated root so tests don't interfere.
function makeTestRoot(): string {
  const root = join(tmpdir(), `settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function importRoute(root: string) {
  process.env['G5000_ROUTER_ROOT'] = root;
  // Dynamic import with a cache-busting query to avoid module cache reuse
  // across tests (vitest resets modules between describe blocks only if
  // unstable_mockReset is set; using vi.resetModules() is the clean approach
  // but for a lightweight fs-based route a re-import with env override is
  // simpler and sufficient here because each test sets the env before import).
  return await import('./route.js');
}

describe('/api/settings GET', () => {
  it('returns {} when no settings file exists', async () => {
    const root = makeTestRoot();
    const { GET } = await importRoute(root);
    const res = await GET();
    const body = (await res.json()) as { ok: boolean; settings: unknown };
    expect(body.ok).toBe(true);
    expect(body.settings).toEqual({});
  });
});

describe('/api/settings PUT', () => {
  it('writes the whole file and returns ok', async () => {
    const root = makeTestRoot();
    const { GET, PUT } = await importRoute(root);
    const req = new Request('http://x/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planning: { maxHours: 48 }, forecastBbox: { latMin: 40 } }),
    });
    const putRes = await PUT(req);
    expect(putRes.status).toBe(200);
    const getBody = (await (await GET()).json()) as { settings: Record<string, unknown> };
    expect(getBody.settings).toEqual({ planning: { maxHours: 48 }, forecastBbox: { latMin: 40 } });
  });

  it('returns 400 for non-object body', async () => {
    const root = makeTestRoot();
    const { PUT } = await importRoute(root);
    const req = new Request('http://x/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});

describe('/api/settings PATCH', () => {
  it('merges a single key without touching other keys', async () => {
    const root = makeTestRoot();
    const { GET, PUT, PATCH } = await importRoute(root);

    // Seed two keys via PUT
    const seed = new Request('http://x/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planning: { maxHours: 24, stepMinutes: 30 },
        anchorDashboard: { bowHeightM: 1.5 },
        forecastBbox: { latMin: 41, latMax: 45, lonMin: -72, lonMax: -65 },
      }),
    });
    await PUT(seed);

    // PATCH only planning — anchorDashboard and forecastBbox must survive
    const patch = new Request('http://x/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planning: { maxHours: 48, stepMinutes: 30 } }),
    });
    const patchRes = await PATCH(patch);
    expect(patchRes.status).toBe(200);

    const getBody = (await (await GET()).json()) as {
      settings: {
        planning: { maxHours: number };
        anchorDashboard: { bowHeightM: number };
        forecastBbox: { latMin: number };
      };
    };
    // PATCH updated only planning
    expect(getBody.settings.planning.maxHours).toBe(48);
    // anchorDashboard untouched
    expect(getBody.settings.anchorDashboard).toEqual({ bowHeightM: 1.5 });
    // forecastBbox untouched
    expect(getBody.settings.forecastBbox).toEqual({ latMin: 41, latMax: 45, lonMin: -72, lonMax: -65 });
  });

  it('PATCH response includes the full merged settings', async () => {
    const root = makeTestRoot();
    const { PUT, PATCH } = await importRoute(root);
    await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canadianTideCurrents: false }),
      }),
    );
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forecastBbox: { latMin: 10 } }),
      }),
    );
    const body = (await res.json()) as { ok: boolean; settings: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.settings['canadianTideCurrents']).toBe(false);
    expect(body.settings['forecastBbox']).toEqual({ latMin: 10 });
  });

  it('GET after PATCH shows both the patched and the pre-existing key', async () => {
    const root = makeTestRoot();
    const { GET, PUT, PATCH } = await importRoute(root);
    await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emporiaConfig: { legAssignments: {}, hiddenChannels: [] } }),
      }),
    );
    await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canadianTideCurrents: true }),
      }),
    );
    const body = (await (await GET()).json()) as {
      settings: Record<string, unknown>;
    };
    expect(body.settings['canadianTideCurrents']).toBe(true);
    expect(body.settings['emporiaConfig']).toEqual({ legAssignments: {}, hiddenChannels: [] });
  });

  it('PUT still whole-file replaces (back-compat)', async () => {
    const root = makeTestRoot();
    const { GET, PUT, PATCH } = await importRoute(root);
    await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planning: { maxHours: 12 }, forecastBbox: { latMin: 50 } }),
      }),
    );
    // PUT replaces entirely — forecastBbox should be gone
    await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planning: { maxHours: 99 } }),
      }),
    );
    const body = (await (await GET()).json()) as { settings: Record<string, unknown> };
    expect(body.settings['planning']).toEqual({ maxHours: 99 });
    expect(body.settings['forecastBbox']).toBeUndefined();
  });

  it('returns 400 for an array body', async () => {
    const root = makeTestRoot();
    const { PATCH } = await importRoute(root);
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(['planning']),
      }),
    );
    expect(res.status).toBe(400);
  });
});
