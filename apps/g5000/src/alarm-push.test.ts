import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { wireAlarmPush } from './alarm-push.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

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

  it('is skipped entirely when G5000_NTFY_TOPIC is unset', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', '');
    const originalFire = registry.fire;
    wireAlarmPush(registry);
    expect(registry.fire).toBe(originalFire); // registry left untouched
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to the topic with Title/Priority/Tags headers on a CRITICAL fire', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'sula-alarms');
    wireAlarmPush(registry);
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
    expect(String(init.body)).toContain('Anchor drag 45 m');
    expect(String(init.body)).toContain('distanceM: 45');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Registry still fired despite the wrap.
    expect(registry.active()[0]?.id).toBe('anchor-watch');
  });

  it('uses Priority high for WARN and honours G5000_NTFY_URL', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'sula-alarms');
    vi.stubEnv('G5000_NTFY_URL', 'https://push.example.com/');
    wireAlarmPush(registry);
    registry.fire({
      id: 'anchor-watch',
      severity: 'WARN',
      label: 'Anchor drag 45 m',
      sticky: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://push.example.com/sula-alarms');
    expect((init.headers as Record<string, string>).Priority).toBe('high');
  });

  it('does not push INFO fires', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'sula-alarms');
    wireAlarmPush(registry);
    registry.fire({ id: 'note', severity: 'INFO', label: 'note', sticky: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not re-push a refresh of an active-and-unacked alarm', () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'sula-alarms');
    wireAlarmPush(registry);
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
    vi.stubEnv('G5000_NTFY_TOPIC', 'sula-alarms');
    fetchMock.mockRejectedValue(new Error('offline'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wireAlarmPush(registry);
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
