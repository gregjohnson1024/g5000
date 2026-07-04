import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { wireAlarmPush } from './alarm-push.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeConfigRef(push?: { ntfyTopic: string | null; ntfyUrl: string | null }): {
  current: AlarmsConfig;
} {
  const cfg = structuredClone(DEFAULT_ALARMS_CONFIG);
  if (push) cfg.push = push;
  return { current: cfg };
}

function geoSample(lat: number, lon: number) {
  return {
    channel: 'nav.gps.position',
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source: 'test',
  };
}

describe('wireAlarmPush', () => {
  let registry: AlarmsRegistry;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = createAlarmsRegistry();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not push when no topic is configured anywhere (config null, env unset)', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', '');
    wireAlarmPush(registry, { configRef: makeConfigRef() });
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    expect(fetchMock).not.toHaveBeenCalled();
    // …but the fire itself still lands.
    expect(registry.active()[0]?.id).toBe('mob');
  });

  it('uses the config topic/url and POSTs Title/Priority/Tags on a CRITICAL fire', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'anchor-watch',
      severity: 'CRITICAL',
      label: 'Anchor drag 45 m',
      sticky: true,
      context: { distanceM: 45, escalated: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ntfy.sh/sula-alarms');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Title: 'Anchor drag 45 m',
      Priority: 'urgent',
      Tags: 'warning',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(registry.active()[0]?.id).toBe('anchor-watch');
  });

  it('config topic/url win over the env vars', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'env-topic');
    vi.stubEnv('G5000_NTFY_URL', 'https://env.example.com');
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'cfg-topic', ntfyUrl: 'https://cfg.example.com/' }),
    });
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://cfg.example.com/cfg-topic');
  });

  it('falls back to env G5000_NTFY_TOPIC/G5000_NTFY_URL when config values are null/blank', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'env-topic');
    vi.stubEnv('G5000_NTFY_URL', 'https://push.example.com/');
    wireAlarmPush(registry, { configRef: makeConfigRef({ ntfyTopic: '  ', ntfyUrl: null }) });
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 45 m',
      sticky: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://push.example.com/env-topic');
    expect((init.headers as Record<string, string>).Priority).toBe('high');
  });

  it('reads the topic at push time — a topic set after wiring takes effect', () => {
    const configRef = makeConfigRef();
    wireAlarmPush(registry, { configRef });
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    expect(fetchMock).not.toHaveBeenCalled();
    registry.clear('mob');
    registry.ack('mob');
    configRef.current = {
      ...configRef.current,
      push: { ntfyTopic: 'late-topic', ntfyUrl: null },
    };
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://ntfy.sh/late-topic');
  });

  it('MOB push includes the DMM position from the fire context', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'mob',
      severity: 'CRITICAL',
      label: 'MOB',
      sticky: true,
      context: { lat: 41.486667, lon: -71.325 },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('position 41 29.200n 71 19.500w');
  });

  it('MOB push without a context position is enriched from the last bus fix', () => {
    const bus = new Bus();
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
      bus,
    });
    bus.publish(geoSample(41.486667, -71.325));
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true, context: {} });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('position 41 29.200n 71 19.500w');
  });

  it('MOB push with no context and no fix says position unknown', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('position unknown');
  });

  it('anchor-watch push includes the drag distance', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 45 m',
      sticky: false,
      context: { distanceM: 45, position: { lat: 41.5, lon: -71.3 } },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('45 m from anchor');
  });

  it('high-wind push includes the observed TWS', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'high-wind',
      severity: 'WARN',
      label: 'High wind 34.2 kn',
      sticky: false,
      context: { twsKn: 34.21, thresholdKn: 30 },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('TWS 34.2 kn');
    expect(String(init.body)).toContain('threshold 30 kn');
  });

  it('unknown ids fall back to the default label + context body', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'shallow-water',
      severity: 'WARN',
      label: 'Shallow Water',
      sticky: false,
      context: { depthM: 2.4 },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('Shallow Water');
    expect(String(init.body)).toContain('depthM: 2.4');
  });

  it('does not push INFO fires', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({ id: 'note', severity: 'INFO', label: 'note', sticky: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not re-push a refresh of an active-and-unacked alarm', () => {
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 45 m',
      sticky: false,
    });
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 52 m',
      sticky: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …but a clear + re-fire (the escalation path) is a fresh transition.
    registry.clear('anchor-watch');
    registry.fire({
      id: 'anchor-watch',
      severity: 'CRITICAL',
      label: 'Anchor drag 60 m',
      sticky: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch rejections without throwing into the alarm path', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wireAlarmPush(registry, {
      configRef: makeConfigRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null }),
    });
    expect(() =>
      registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true }),
    ).not.toThrow();
    await flush();
    expect(registry.active()[0]?.id).toBe('mob'); // alarm unaffected
    expect(warnSpy).toHaveBeenCalledTimes(1); // logged once…
    registry.clear('mob');
    registry.ack('mob');
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(1); // …and only once
    warnSpy.mockRestore();
  });
});
