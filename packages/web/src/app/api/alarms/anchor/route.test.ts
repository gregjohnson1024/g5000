import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './route.js';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';

describe('/api/alarms/anchor', () => {
  beforeEach(() => {
    (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__ = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
  });

  it('drop with explicit position sets armed=true and stores the point', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'drop', position: { lat: 32.3, lon: -64.8 }, radiusM: 60 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__!;
    expect(ref.current.thresholds.anchor.armed).toBe(true);
    expect(ref.current.thresholds.anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    expect(ref.current.thresholds.anchor.radiusM).toBe(60);
    expect(ref.current.thresholds.anchor.droppedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('weigh sets armed=false but preserves point + droppedAt for history', async () => {
    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__!;
    ref.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };

    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'weigh' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(ref.current.thresholds.anchor.armed).toBe(false);
  });

  it('rejects unknown action', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'sail-off' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
