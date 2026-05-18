import type { Bus } from '@g5000/core';
import { getPgnFirehose } from '@g5000/core';
import { mergeMap, from, share, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';
import { mapSentenceToSamples } from './nmea0183/channel-mapper.js';
import { handleAisPgn, isAisPgn } from './ais/ais-handler.js';
import { handleAlertPgn } from './alerts/handler.js';
import { getSharedDeviceRegistry } from './index.js';

/**
 * Mutable registry of WireDrivers wired into the bus. Lets the runtime add
 * or remove a driver after boot without restarting the process — the
 * subscriptions to the decoder + channel-mapper + device-registry +
 * firehose + AIS + alerts pipelines are added per-driver and torn down
 * cleanly when the driver is removed.
 *
 * Each driver is registered under a string `label` so the caller can refer
 * to it later for removal (e.g. `'socketcan'`, `'ydwg'`). Labels are
 * unique within a hub — `addDriver` rejects duplicates so a misbehaving
 * caller can't silently shadow an existing driver.
 */
export interface DriverHub {
  /**
   * Start the driver, subscribe all pipelines, and register under `label`.
   * Rejects if a driver is already registered under that label.
   */
  addDriver(label: string, driver: WireDriver): Promise<void>;
  /**
   * Unsubscribe all pipelines for the driver registered under `label` and
   * stop it. No-op if no such driver exists, so callers can blindly
   * `removeDriver('socketcan')` on toggle-off without checking first.
   */
  removeDriver(label: string): Promise<void>;
  /** Current set of registered driver labels. */
  listDrivers(): string[];
  /** Convenience: is a driver registered under this label right now? */
  hasDriver(label: string): boolean;
  /** Stop every driver and unsubscribe everything. Idempotent. */
  teardown(): Promise<void>;
}

interface DriverEntry {
  driver: WireDriver;
  subs: Subscription[];
}

/**
 * Build a fresh DriverHub bound to `bus`. The hub uses the shared device
 * registry and PGN firehose singletons — same as the previous static
 * `runBridge` wiring — so existing consumers of those (the /devices page,
 * the /sniff page) see no behaviour change.
 */
export function createDriverHub(bus: Bus): DriverHub {
  const registry = getSharedDeviceRegistry();
  const firehose = getPgnFirehose();
  const entries = new Map<string, DriverEntry>();

  function subscribeDriverPipelines(driver: WireDriver): Subscription[] {
    const subs: Subscription[] = [];

    // Decode once and share so the five CAN consumers below all observe
    // the same decoded stream — running canboatjs once per frame instead
    // of five times per frame.
    const decoded$ = driver.rxCan.pipe(decode(), share());

    // 1) PGN → channel mapper → bus (the main path that drives the UI).
    subs.push(
      decoded$.pipe(mergeMap((pgn) => from(mapPgnToSamples(pgn)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] CAN pipeline error (subscription terminated)', err);
        },
      }),
    );

    // 2) Device registry — every decoded PGN is an "observed on the bus".
    subs.push(
      decoded$.subscribe({
        next: (pgn) => registry.observe(pgn),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] device-registry pipeline error', err);
        },
      }),
    );

    // 3) Firehose — same decoded PGN goes onto the shared subject so
    // sniffers can subscribe without plumbing through the bridge.
    subs.push(
      decoded$.subscribe({
        next: (pgn) =>
          firehose.next({
            pgn: pgn.pgn,
            src: pgn.src,
            prio: pgn.prio,
            dst: pgn.dst,
            fields: pgn.fields,
            rxTimestamp: pgn.rxTimestamp,
          }),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] firehose pipeline error', err);
        },
      }),
    );

    // 4) AIS — per-MMSI registry, separate from the bus so we don't get
    // per-vessel channel proliferation.
    subs.push(
      decoded$.subscribe({
        next: (pgn) => {
          if (isAisPgn(pgn.pgn)) handleAisPgn(pgn.pgn, pgn.fields);
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] AIS pipeline error', err);
        },
      }),
    );

    // 5) Alerts — standard 126983/126985 + Navico's proprietary 130850.
    subs.push(
      decoded$.subscribe({
        next: (pgn) => {
          if (pgn.pgn === 126983 || pgn.pgn === 126985 || pgn.pgn === 130850) {
            handleAlertPgn(pgn);
          }
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] alerts pipeline error', err);
        },
      }),
    );

    // 6) 0183 path — direct to the bus via the sentence mapper.
    subs.push(
      driver.rx0183.pipe(mergeMap((s) => from(mapSentenceToSamples(s)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[driver-hub] 0183 pipeline error (subscription terminated)', err);
        },
      }),
    );

    return subs;
  }

  return {
    async addDriver(label, driver) {
      if (entries.has(label)) {
        throw new Error(`DriverHub: a driver is already registered under "${label}"`);
      }
      await driver.start();
      // Subscribe AFTER start() so a driver that fails to start doesn't
      // leave behind dead subscriptions waiting on observables from a
      // partially-initialised channel.
      const subs = subscribeDriverPipelines(driver);
      entries.set(label, { driver, subs });
    },
    async removeDriver(label) {
      const e = entries.get(label);
      if (!e) return;
      for (const s of e.subs) s.unsubscribe();
      entries.delete(label);
      // Stop after unsubscribing so a stop()-emitted final frame can't
      // race into a now-detached pipeline.
      await e.driver.stop();
    },
    listDrivers() {
      return Array.from(entries.keys());
    },
    hasDriver(label) {
      return entries.has(label);
    },
    async teardown() {
      // Capture labels first — entries mutates during iteration.
      const labels = Array.from(entries.keys());
      for (const label of labels) {
        const e = entries.get(label);
        if (!e) continue;
        for (const s of e.subs) s.unsubscribe();
        entries.delete(label);
        await e.driver.stop();
      }
    },
  };
}

// Process-wide singleton — mirrors getSharedBus / getSharedDeviceRegistry /
// getSharedConfigStore. Stored on globalThis so Next.js / Turbopack module
// re-evaluation doesn't fork the hub. Route handlers and any other server
// code can call getSharedDriverHub() to add or remove drivers at runtime.
const HUB_KEY = '__g5000_driver_hub__';
type GlobalWithHub = typeof globalThis & { [HUB_KEY]?: DriverHub };

export function setSharedDriverHub(hub: DriverHub): void {
  (globalThis as GlobalWithHub)[HUB_KEY] = hub;
}

export function getSharedDriverHub(): DriverHub | null {
  return (globalThis as GlobalWithHub)[HUB_KEY] ?? null;
}

/** Test helper — wipes the shared hub. Production code shouldn't call this. */
export function _resetSharedDriverHubForTests(): void {
  delete (globalThis as GlobalWithHub)[HUB_KEY];
}
