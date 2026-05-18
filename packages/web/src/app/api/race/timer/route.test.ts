import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route.js';
import { createRaceState, setSharedRaceState, _resetSharedRaceStateForTests } from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

function req(body: unknown): Request {
  return new Request('http://test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/race/timer', () => {
  it('start sets startMs to now + offsetSec (default 300)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'start' }));
    expect(r.status).toBe(200);
    expect(rs.get().timer.startMs).toBe(Date.now() + 300_000);
    expect(rs.get().timer.state).toBe('pre-start');
    vi.useRealTimers();
  });

  it('start with offsetSec uses the provided value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    setSharedRaceState(rs);
    await POST(req({ action: 'start', offsetSec: 600 }));
    expect(rs.get().timer.startMs).toBe(Date.now() + 600_000);
    vi.useRealTimers();
  });

  it('sync shifts startMs by adjustSec', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    rs.mutate((d) => {
      d.timer.startMs = Date.now() + 100_000;
      d.timer.state = 'pre-start';
    });
    setSharedRaceState(rs);
    await POST(req({ action: 'sync', adjustSec: -30 }));
    expect(rs.get().timer.startMs).toBe(Date.now() + 70_000);
    vi.useRealTimers();
  });

  it('reset clears the timer', async () => {
    const rs = createRaceState();
    rs.mutate((d) => {
      d.timer.startMs = 9999;
      d.timer.state = 'pre-start';
    });
    setSharedRaceState(rs);
    await POST(req({ action: 'reset' }));
    expect(rs.get().timer.startMs).toBeNull();
    expect(rs.get().timer.state).toBe('idle');
  });

  it('unknown action returns 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'spin' }));
    expect(r.status).toBe(400);
  });
});
