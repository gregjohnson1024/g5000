import { describe, it, expect, vi } from 'vitest';
import { Bus } from '@g5000/core';
import { startRadarStatusPoller } from './status-poller.js';

describe('startRadarStatusPoller', () => {
  it('publishes connected=1 when mayara responds', async () => {
    const bus = new Bus();
    let v = -1;
    bus.subscribe('radar.connected', (s) => {
      if (s.value.kind === 'scalar') v = s.value.value;
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ r1: { spokeDataUrl: 'ws://x/spokes' } })),
    ) as unknown as typeof fetch;
    const stop = startRadarStatusPoller(bus, {
      baseUrl: 'http://pi:6502',
      intervalMs: 10,
      fetchImpl,
    });
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(v).toBe(1);
  });

  it('publishes connected=0 when mayara is down', async () => {
    const bus = new Bus();
    let v = -1;
    bus.subscribe('radar.connected', (s) => {
      if (s.value.kind === 'scalar') v = s.value.value;
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const stop = startRadarStatusPoller(bus, {
      baseUrl: 'http://pi:6502',
      intervalMs: 10,
      fetchImpl,
    });
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(v).toBe(0);
  });
});
