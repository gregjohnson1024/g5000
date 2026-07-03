import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, POST } from './route.js';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { createAlarmsRegistry, setSharedAlarms, _resetAlarmsForTests } from '@g5000/core';
import { haversineMeters, initialBearingDeg } from '@g5000/compute';

describe('/api/alarms/anchor', () => {
  beforeEach(() => {
    (
      globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }
    ).__g5000_alarms_config_ref__ = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
  });

  afterEach(() => {
    _resetAlarmsForTests();
  });

  it('drop with explicit position sets armed=true and stores the point', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'drop', position: { lat: 32.3, lon: -64.8 }, radiusM: 60 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } })
      .__g5000_alarms_config_ref__!;
    expect(ref.current.thresholds.anchor.armed).toBe(true);
    expect(ref.current.thresholds.anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    expect(ref.current.thresholds.anchor.radiusM).toBe(60);
    expect(ref.current.thresholds.anchor.droppedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('weigh sets armed=false but preserves point + droppedAt for history', async () => {
    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } })
      .__g5000_alarms_config_ref__!;
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

  it('drop without an offset resolves anchorPoint to the drop position', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'drop', position: { lat: 32.3, lon: -64.8 } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } })
      .__g5000_alarms_config_ref__!;
    expect(ref.current.thresholds.anchor.anchorPoint).toEqual({ lat: 32.3, lon: -64.8 });
  });

  it('drop with an offset projects anchorPoint from the drop position', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({
        action: 'drop',
        position: { lat: 32.3, lon: -64.8 },
        radiusM: 60,
        offsetM: 40,
        offsetBearingDeg: 90,
        coneDeg: 120,
        coneCenterDeg: 270,
        escalateAfterS: 45,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const anchor = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } })
      .__g5000_alarms_config_ref__!.current.thresholds.anchor;
    expect(anchor.armed).toBe(true);
    expect(anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    const anchorPoint = anchor.anchorPoint!;
    expect(haversineMeters({ lat: 32.3, lon: -64.8 }, anchorPoint)).toBeCloseTo(40, 0);
    expect(initialBearingDeg({ lat: 32.3, lon: -64.8 }, anchorPoint)).toBeCloseTo(90, 1);
    expect(anchor.offsetM).toBe(40);
    expect(anchor.offsetBearingDeg).toBe(90);
    expect(anchor.coneDeg).toBe(120);
    expect(anchor.coneCenterDeg).toBe(270);
    expect(anchor.escalateAfterS).toBe(45);
  });

  it('GET returns the current threshold plus breach state from the registry', async () => {
    const registry = createAlarmsRegistry();
    setSharedAlarms(registry);
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 45 m',
      sticky: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      anchor: { armed: boolean; radiusM: number };
      breached: boolean;
      alarm: { id: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.anchor.radiusM).toBe(DEFAULT_ALARMS_CONFIG.thresholds.anchor.radiusM);
    expect(body.breached).toBe(true);
    expect(body.alarm?.id).toBe('anchor-watch');
  });

  it('weigh retires an active sticky anchor alarm (clear + ack)', async () => {
    const registry = createAlarmsRegistry();
    setSharedAlarms(registry);
    registry.fire({
      id: 'anchor-watch',
      severity: 'CRITICAL',
      label: 'Anchor drag 80 m',
      sticky: true,
      context: { escalated: true },
    });
    expect(registry.active()).toHaveLength(1);

    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'weigh' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(registry.active()).toHaveLength(0);
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
