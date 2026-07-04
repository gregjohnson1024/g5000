// packages/bridge/src/victron/mqtt-driver.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bus } from '@g5000/core';
import { createVictronRegistry } from './registry.js';
import { startVictronMqttDriver, type MqttLike } from './mqtt-driver.js';
import { setSharedVictron } from '@g5000/core';

function fakeClient() {
  const handlers = new Map<string, (...a: any[]) => void>();
  const published: Array<[string, string]> = [];
  const subscribed: string[] = [];
  const client: MqttLike & { emit: (ev: string, ...a: any[]) => void } = {
    on: (ev, cb) => handlers.set(ev, cb),
    subscribe: (t) => subscribed.push(t),
    publish: (t, p) => published.push([t, p]),
    end: () => {},
    emit: (ev, ...a) => handlers.get(ev)?.(...a),
  };
  return { client, published, subscribed };
}

describe('startVictronMqttDriver', () => {
  beforeEach(() => {
    setSharedVictron(undefined as never);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('discovers the portal id, subscribes, and starts a 30s keepalive', () => {
    const { client, published, subscribed } = fakeClient();
    const bus = new Bus();
    const registry = createVictronRegistry();
    const stop = startVictronMqttDriver({
      host: 'x',
      registry,
      bus,
      connect: () => client,
    });
    client.emit('connect');
    // Learns portal id from a Serial topic:
    client.emit(
      'message',
      'N/abc123/system/0/Serial',
      Buffer.from(JSON.stringify({ value: 'abc123' })),
    );
    expect(subscribed).toContain('N/abc123/#');
    expect(published.some(([t]) => t === 'R/abc123/keepalive')).toBe(true);
    published.length = 0;
    vi.advanceTimersByTime(30_000);
    const ka = published.find(([t]) => t === 'R/abc123/keepalive');
    expect(ka).toBeTruthy();
    expect(ka![1]).toContain('suppress-republish');
    stop();
  });

  it('feeds instrument messages into the registry snapshot', () => {
    const { client } = fakeClient();
    const registry = createVictronRegistry();
    startVictronMqttDriver({
      host: 'x',
      portalId: 'p',
      registry,
      bus: new Bus(),
      connect: () => client,
    });
    client.emit('connect');
    client.emit(
      'message',
      'N/p/system/0/Dc/Battery/Soc',
      Buffer.from(JSON.stringify({ value: 55 })),
    );
    expect(registry.snapshot().battery.soc).toBe(55);
  });
});
