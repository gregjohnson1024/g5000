import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from './route.js';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';

describe('/api/alarms/config', () => {
  beforeEach(() => {
    // Reset the alarms config ref shared via globalThis
    (
      globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }
    ).__g5000_alarms_config_ref__ = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
  });

  it('GET returns the current AlarmsConfig from the in-memory ref', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.enabled.mob).toBe(true);
    expect(body.thresholds.shallowWater.thresholdM).toBeGreaterThan(0);
  });

  it('PUT updates the in-memory ref so predicates pick it up live', async () => {
    const next = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, 'over-speed': false },
    };
    const req = new Request('http://test', { method: 'PUT', body: JSON.stringify(next) });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const after = await (await GET()).json();
    expect(after.enabled['over-speed']).toBe(false);
  });

  it('PUT rejects a malformed body with 400 and leaves the live config intact', async () => {
    // An empty/partial payload used to silently overwrite the live config,
    // disabling every alarm. The route must reject it and keep the old config.
    const req = new Request('http://test', { method: 'PUT', body: JSON.stringify({}) });
    const res = await PUT(req);
    expect(res.status).toBe(400);

    const after = await (await GET()).json();
    expect(after.enabled.mob).toBe(true);
    expect(after.thresholds.shallowWater.thresholdM).toBeGreaterThan(0);
  });
});
