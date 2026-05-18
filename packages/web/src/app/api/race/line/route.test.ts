import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './route.js';
import {
  createRaceState,
  setSharedRaceState,
  _resetSharedRaceStateForTests,
} from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

function req(body: unknown): Request {
  return new Request('http://test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/race/line', () => {
  it('ping port end records lat/lon at provided position', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'ping', end: 'port', position: { lat: 41.5, lon: -71.3 } }));
    expect(r.status).toBe(200);
    expect(rs.get().line.port?.lat).toBe(41.5);
    expect(rs.get().line.port?.lon).toBe(-71.3);
    expect(rs.get().line.port?.pingedAt).toBeDefined();
  });

  it('second ping determines preStartSide based on current position', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    await POST(req({ action: 'ping', end: 'port', position: { lat: 41.5, lon: -71.3 } }));
    await POST(
      req({
        action: 'ping',
        end: 'stbd',
        position: { lat: 41.5, lon: -71.29 },
        boatPos: { lat: 41.49, lon: -71.295 },
      }),
    );
    expect(rs.get().line.preStartSide).toBeDefined();
    expect(['port', 'stbd']).toContain(rs.get().line.preStartSide);
  });

  it('clear wipes both endpoints and preStartSide', async () => {
    const rs = createRaceState();
    rs.mutate((d) => {
      d.line.port = { lat: 0, lon: 0, pingedAt: 'x' };
      d.line.stbd = { lat: 0, lon: 0, pingedAt: 'x' };
      d.line.preStartSide = 'port';
    });
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'clear' }));
    expect(r.status).toBe(200);
    expect(rs.get().line.port).toBeUndefined();
    expect(rs.get().line.stbd).toBeUndefined();
    expect(rs.get().line.preStartSide).toBeUndefined();
  });

  it('ping without position returns 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'ping', end: 'port' }));
    expect(r.status).toBe(400);
  });
});
