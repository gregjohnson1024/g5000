import { describe, it, expect, afterEach } from 'vitest';
import { _resetSharedBusForTests } from '@g5000/core';
import { GET } from './route.js';

describe('GET /api/position', () => {
  afterEach(() => {
    _resetSharedBusForTests();
  });

  it('returns a Server-Sent Events stream', async () => {
    const res = await GET();
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    // Drain/close the stream so the test doesn't leak the underlying timer.
    await res.body?.cancel();
  });
});
