import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let POST: (req: Request) => Promise<Response>;

const pruneCache = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  pruneCache.mockReset();
  pruneCache.mockResolvedValue({ removedTiles: 2, removedBytes: 2048, totalBytesAfter: 1000 });
  // Mock the shared lib so the route test stays pure (no real disk walk).
  vi.doMock('../../../../lib/sat-cache', () => ({
    pruneCache,
    CAP_BYTES: 8 * 1024 ** 3,
  }));
  vi.doMock('../../../../lib/paths', () => ({ ROOT: '/tmp/router' }));
  ({ POST } = await import('./route'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../../../lib/sat-cache');
  vi.doUnmock('../../../../lib/paths');
});

describe('POST /api/sat-cache/prune', () => {
  it('passes olderThanDays through to pruneCache', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ olderThanDays: 90 }) }),
    );
    expect(res.status).toBe(200);
    expect(pruneCache).toHaveBeenCalledWith('/tmp/router/sat-cache', { olderThanDays: 90 });
    const body = (await res.json()) as { removedTiles: number };
    expect(body.removedTiles).toBe(2);
  });

  it('converts maxGb to bytes', async () => {
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ maxGb: 8 }) }));
    expect(pruneCache).toHaveBeenCalledWith('/tmp/router/sat-cache', { maxBytes: 8 * 1024 ** 3 });
  });

  it('400s when neither option is provided', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
    expect(pruneCache).not.toHaveBeenCalled();
  });
});
