import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from './route.js';
import {
  createRaceState,
  setSharedRaceState,
  _resetSharedRaceStateForTests,
} from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

describe('/api/race/state', () => {
  it('GET returns the current RaceStateConfig', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.timer.state).toBe('idle');
    expect(body.settings.shiftThresholdDeg).toBe(7);
  });

  it('PUT updates settings and persists via the shared raceState', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const req = new Request('http://test/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { shiftThresholdDeg: 12, laylineDistanceNm: 8 },
      }),
    });
    const r = await PUT(req);
    expect(r.status).toBe(200);
    expect(rs.get().settings.shiftThresholdDeg).toBe(12);
    expect(rs.get().settings.laylineDistanceNm).toBe(8);
    expect(rs.get().settings.integrateCurrent).toBe(true); // not touched
  });

  it('GET returns 503 when no shared raceState', async () => {
    const r = await GET();
    expect(r.status).toBe(503);
  });

  it('PUT rejects invalid JSON with 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const req = new Request('http://test/', { method: 'PUT', body: '{' });
    const r = await PUT(req);
    expect(r.status).toBe(400);
  });
});
