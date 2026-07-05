import mqtt from 'mqtt';
import type { Bus, VictronRegistry } from '@g5000/core';
import { publishVictronToBus } from './publisher.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MqttLike {
  on(ev: string, cb: (...a: any[]) => void): void;
  subscribe(topic: string): void;
  publish(topic: string, payload: string): void;
  end(): void;
}

export type MqttConnectFn = (url: string) => MqttLike;

export interface VictronDriverOpts {
  host: string;
  port?: number;
  portalId?: string;
  registry: VictronRegistry;
  bus: Bus;
  publishIntervalMs?: number;
  keepaliveMs?: number;
  connect?: MqttConnectFn;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_PUBLISH_MS = 1_000;
const DEFAULT_KEEPALIVE_MS = 30_000;
const KEEPALIVE_PAYLOAD = JSON.stringify({ 'keepalive-options': ['suppress-republish'] });

/**
 * Start the Victron MQTT driver.
 *
 * Connects to a Cerbo GX (or any MQTT broker) at `host:port`, discovers the
 * portal id via `N/+/system/0/Serial` if not provided, subscribes to all
 * Victron topics, and maintains a 30-second keepalive so the broker keeps
 * sending real-time data.  Instrument messages are written into `registry`;
 * headline channels are published on `bus` every `publishIntervalMs`.
 *
 * The returned teardown function clears all timers and ends the MQTT
 * connection gracefully.  It is safe to call multiple times and will not throw.
 */
export function startVictronMqttDriver(opts: VictronDriverOpts): () => void {
  const {
    host,
    port = 1883,
    registry,
    bus,
    publishIntervalMs = DEFAULT_PUBLISH_MS,
    keepaliveMs = DEFAULT_KEEPALIVE_MS,
  } = opts;

  let portalId: string | undefined = opts.portalId;

  // Injected connect factory (for tests) or the real mqtt.connect.
  const connectFn: MqttConnectFn =
    opts.connect ?? ((url) => mqtt.connect(url, { reconnectPeriod: 5_000 }));

  const url = `mqtt://${host}:${port}`;
  const client = connectFn(url);

  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let publishTimer: ReturnType<typeof setInterval> | undefined;

  // Clear ONLY the keepalive — called on disconnect so the keepalive doesn't
  // fire against a dead connection.  The publish timer is intentionally kept
  // running across reconnects so Bus consumers never go silent.
  function clearKeepalive(): void {
    if (keepaliveTimer !== undefined) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = undefined;
    }
  }

  // Full teardown — clear both timers.  Only called by stop().
  function clearAllTimers(): void {
    clearKeepalive();
    if (publishTimer !== undefined) {
      clearInterval(publishTimer);
      publishTimer = undefined;
    }
  }

  function bootstrap(id: string): void {
    portalId = id;
    client.subscribe(`N/${id}/#`);
    // Initial keepalive — empty payload, triggers a data burst from the broker.
    client.publish(`R/${id}/keepalive`, '');
    // Periodic keepalive to suppress auto-republish throttling.
    keepaliveTimer = setInterval(() => {
      client.publish(`R/${id}/keepalive`, KEEPALIVE_PAYLOAD);
    }, keepaliveMs);
  }

  client.on('connect', () => {
    registry.setConnected(true);
    if (portalId) {
      bootstrap(portalId);
    } else {
      // Subscribe to the Serial topic on all portals so we can discover the id.
      client.subscribe('N/+/system/0/Serial');
    }
  });

  client.on('message', (topic: string, payload: Buffer) => {
    if (!portalId) {
      // Portal discovery: look for N/<id>/system/0/Serial
      const match = topic.match(/^N\/([^/]+)\/system\/0\/Serial$/);
      if (match) {
        bootstrap(match[1]!);
      }
      // Don't pass the Serial topic to the registry — there's nothing useful in it.
      return;
    }
    registry.update(topic, payload.toString());
  });

  client.on('close', () => {
    registry.markStale();
    clearKeepalive(); // keep the publish loop alive for the reconnect
    // mqtt's built-in reconnect (reconnectPeriod) handles retry backoff.
  });

  client.on('error', () => {
    registry.markStale();
    clearKeepalive(); // keep the publish loop alive for the reconnect
  });

  // Periodic bus publish so headline channels stay fresh.  Kept running across
  // reconnects — registry.markStale() ensures the snapshot reflects the
  // disconnected state until the connection is restored.
  publishTimer = setInterval(() => {
    publishVictronToBus(bus, registry.snapshot());
  }, publishIntervalMs);

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------
  return function stop(): void {
    try {
      clearAllTimers();
      client.end();
      registry.markStale();
    } catch {
      // never throw on teardown
    }
  };
}
