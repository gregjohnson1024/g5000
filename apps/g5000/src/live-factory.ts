import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { SerialPort } from 'serialport';
import type { Bus, BaseSourceHandle, SourceModeController } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import { startTrueWindPipeline } from '@g5000/compute';
import {
  Ngt1Driver,
  SerialPort0183Driver,
  YdwgRawTcpDriver,
  createYdwgTcpSocketFactory,
  SocketCanDriver,
  createSocketCanRawChannelFactory,
  getSharedDriverHub,
  runBridge,
  startSessionLogger,
  startTrueWindTx,
  getSharedDeviceRegistry,
  createAlertsRegistry,
  type WireDriver,
  type OutgoingPgn,
} from '@g5000/bridge';
import { startDemoInjector } from './demo-injector.js';
import { startSogStats } from './sog-stats.js';
import { startCogStats } from './cog-stats.js';
import { startHdgStats } from './hdg-stats.js';
import { startMotionStats } from './motion-stats.js';
import { installDeviceDiscovery } from './device-discovery.js';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const NMEA0183_PATHS = (process.env.NMEA0183_PATHS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const NMEA0183_BAUD = Number(process.env.NMEA0183_BAUD ?? 4800);
// Default to Sula's YDWG-02 at 192.168.1.100 — same fixed IP on every
// vessel network we currently use (documented in the boat-network-map).
// Override with YDWG_HOST=… for testing or a different boat; set
// YDWG_HOST=none to disable the driver outright.
const YDWG_HOST_RAW = process.env.YDWG_HOST ?? '192.168.1.100';
const YDWG_HOST = YDWG_HOST_RAW === 'none' ? null : YDWG_HOST_RAW;
const YDWG_PORT = Number(process.env.YDWG_PORT ?? 1457);
const SESSION_LOG_DIR = process.env.SESSION_LOG_DIR ?? null;
const SKIP_BRIDGE = process.env.SKIP_BRIDGE === '1';

// SocketCAN ingest is opt-in. Default off so existing Pi installs keep
// running on YDWG/NGT-1 with zero behaviour change. Enabled via the /settings
// UI (writes to ~/.g5000-router/settings.json) OR via env-var override
// (handy for testing): SOCKETCAN_ENABLED=1 SOCKETCAN_INTERFACE=can0.
const SOCKETCAN_ROOT = process.env.G5000_ROUTER_ROOT ?? path.join(homedir(), '.g5000-router');
const SOCKETCAN_SETTINGS_PATH = path.join(SOCKETCAN_ROOT, 'settings.json');

interface SocketCanSettings {
  enabled: boolean;
  interface: string;
}

async function readSocketCanSettings(): Promise<SocketCanSettings> {
  // Env-var override wins, since it's the operator's emergency knob.
  if (process.env.SOCKETCAN_ENABLED === '1') {
    return {
      enabled: true,
      interface: process.env.SOCKETCAN_INTERFACE ?? 'can0',
    };
  }
  if (process.env.SOCKETCAN_ENABLED === '0') {
    return { enabled: false, interface: 'can0' };
  }
  // Otherwise read the persisted settings.json (Settings UI writes here).
  try {
    const buf = await readFile(SOCKETCAN_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(buf) as { socketCan?: Partial<SocketCanSettings> };
    const sc = parsed.socketCan;
    if (sc && typeof sc === 'object') {
      return {
        enabled: sc.enabled === true,
        interface:
          typeof sc.interface === 'string' && sc.interface.length > 0 ? sc.interface : 'can0',
      };
    }
  } catch {
    /* file missing / malformed — default to disabled */
  }
  return { enabled: false, interface: 'can0' };
}

/**
 * Mutable holder for the most-recently-built base-source teardown. The
 * SourceModeController owns the handle internally; this holder shadows its
 * teardown so SIGINT can unwind the live/demo source without a new controller
 * method. Each factory updates `current` on entry; its teardown clears it
 * ONLY if it is still the active one (identity check survives a live↔demo
 * swap that reassigned the holder to a newer teardown).
 */
export interface BaseTeardownHolder {
  current: (() => Promise<void>) | null;
}

/**
 * Demo factory — synthetic samples published directly to the bus. The
 * true-wind compute pipeline is NOT started here (demo publishes
 * calibrated wind directly; running the pipeline would overwrite it).
 */
export function createDemoFactory(deps: {
  bus: Bus;
  baseTeardownHolder: BaseTeardownHolder;
}): () => Promise<BaseSourceHandle> {
  const { bus, baseTeardownHolder } = deps;
  const demoFactory = async (): Promise<BaseSourceHandle> => {
    const stopDemo = startDemoInjector(bus);
    // eslint-disable-next-line no-console
    console.log('[autopilot] demo mode — synthetic samples publishing to the bus');
    const teardownFn = async (): Promise<void> => {
      stopDemo();
      if (baseTeardownHolder.current === teardownFn) baseTeardownHolder.current = null;
    };
    baseTeardownHolder.current = teardownFn;
    return {
      teardown: teardownFn,
      restart: demoFactory,
    };
  };
  return demoFactory;
}

/**
 * Live factory — open NGT-1 + 0183 ports, run bridge, start session
 * logger + true-wind compute + true-wind TX. The composite teardown
 * unwinds in reverse start order.
 */
export function createLiveFactory(deps: {
  bus: Bus;
  store: ConfigStore;
  sourceModeController: SourceModeController;
  baseTeardownHolder: BaseTeardownHolder;
}): () => Promise<BaseSourceHandle> {
  const { bus, store, sourceModeController, baseTeardownHolder } = deps;
  const liveFactory = async (): Promise<BaseSourceHandle> => {
    const drivers: WireDriver[] = [];
    const stops: Array<() => Promise<void>> = [];

    if (!SKIP_BRIDGE) {
      try {
        const port = new SerialPort({
          path: SERIAL_PATH,
          baudRate: BAUD_RATE,
          autoOpen: false,
        });
        await new Promise<void>((resolve, reject) => {
          port.open((err) => (err ? reject(err) : resolve()));
        });
        drivers.push(new Ngt1Driver({ source: port }));
        stops.push(
          () =>
            new Promise<void>((resolve) => {
              port.close(() => resolve());
            }),
        );
        // eslint-disable-next-line no-console
        console.log(`[autopilot] NGT-1 online via ${SERIAL_PATH}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[autopilot] NGT-1 offline (${err instanceof Error ? err.message : String(err)})`,
        );
      }

      if (YDWG_HOST) {
        try {
          const ydwg = new YdwgRawTcpDriver({
            socketFactory: createYdwgTcpSocketFactory(YDWG_HOST, YDWG_PORT),
          });
          await ydwg.start();
          drivers.push(ydwg);
          stops.push(() => ydwg.stop());
          // eslint-disable-next-line no-console
          console.log(`[autopilot] YDWG online via tcp://${YDWG_HOST}:${YDWG_PORT}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] YDWG offline (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }

      // SocketCAN (PiCAN-M) is added AFTER runBridge() below, via the
      // DriverHub with label 'socketcan', so the /api/socketcan endpoint
      // can hot-add or hot-remove it later without restarting the server.
      // (See the post-runBridge block.) Adding it here in the boot array
      // would give it an opaque "boot-N" label and the API endpoint
      // couldn't find it for removal.

      for (const [i, p183] of NMEA0183_PATHS.entries()) {
        try {
          const port = new SerialPort({
            path: p183,
            baudRate: NMEA0183_BAUD,
            autoOpen: false,
          });
          await new Promise<void>((resolve, reject) => {
            port.open((err) => (err ? reject(err) : resolve()));
          });
          drivers.push(new SerialPort0183Driver({ source: port, port: i + 1 }));
          stops.push(
            () =>
              new Promise<void>((resolve) => {
                port.close(() => resolve());
              }),
          );
          // eslint-disable-next-line no-console
          console.log(`[autopilot] 0183 port${i + 1} online via ${p183}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] 0183 port${i + 1} offline (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }

    // Bridge — even with zero drivers we still spin up an orchestrator so
    // teardown is symmetric. Doing it conditionally would split the
    // teardown path.
    let stopBridgeFn: (() => Promise<void>) | null = null;
    if (drivers.length > 0) {
      stopBridgeFn = await runBridge({ bus, drivers });
    }

    // SocketCAN (PiCAN-M) — opt-in via /settings UI or env var. We add it
    // through the shared DriverHub (set up by runBridge above) under the
    // label 'socketcan' so the /api/socketcan endpoint can hot-toggle it
    // later. Failure to start is non-fatal: log it like an offline NGT-1.
    const socketCan = await readSocketCanSettings();
    if (socketCan.enabled) {
      const hub = getSharedDriverHub();
      if (!hub) {
        // eslint-disable-next-line no-console
        console.warn('[autopilot] SocketCAN requested but no DriverHub — was runBridge called?');
      } else {
        try {
          await hub.addDriver(
            'socketcan',
            new SocketCanDriver({
              channelFactory: createSocketCanRawChannelFactory(socketCan.interface),
            }),
          );
          // eslint-disable-next-line no-console
          console.log(`[autopilot] SocketCAN online on ${socketCan.interface}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] SocketCAN offline on ${socketCan.interface} (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }

    // Optional session logger — only when a log dir was configured.
    let stopLoggerFn: (() => Promise<void>) | null = null;
    if (SESSION_LOG_DIR && drivers.length > 0) {
      const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
      const logger = await startSessionLogger({
        drivers,
        dir: SESSION_LOG_DIR,
        sessionId,
      });
      stopLoggerFn = () => logger.close();
      // eslint-disable-next-line no-console
      console.log(
        `[autopilot] session log: ${path.join(SESSION_LOG_DIR, sessionId + '.jsonl.gz')}`,
      );
    }

    // True-wind compute pipeline — live-only (demo publishes calibrated
    // wind directly).
    const stopCompute = await startTrueWindPipeline({ bus, configStore: store });
    // eslint-disable-next-line no-console
    console.log('[autopilot] true-wind compute pipeline online');

    // Rolling-window SOG stats (15-min mean), served via /api/stats/sog.
    // Lives here so the buffer survives client navigation — see
    // src/sog-stats.ts.
    const sogStats = startSogStats(bus);
    stops.push(async () => sogStats.stop());
    const cogStats = startCogStats(bus);
    stops.push(async () => cogStats.stop());
    const hdgStats = startHdgStats(bus);
    stops.push(async () => hdgStats.stop());
    const motionStats = startMotionStats(bus);
    stops.push(async () => motionStats.stop());

    // True-wind TX wiring + device-registry refresh target.
    //   - True-wind TX is NGT-1-only (requires Fast Packet split).
    //   - Device refresh uses ISO Request (PGN 59904, single-frame), which
    //     YDWG can also handle — so we fall back to YDWG when NGT-1 absent.
    const ngt = drivers.find((d) => d instanceof Ngt1Driver);
    const ydwg = drivers.find((d) => d instanceof YdwgRawTcpDriver);
    let stopTxFn: (() => Promise<void>) | null = null;
    let registeredTxer: ((pgn: OutgoingPgn) => Promise<void>) | null = null;
    if (ngt) {
      stopTxFn = await startTrueWindTx({
        bus,
        driver: ngt,
        shouldTransmit: () => sourceModeController.getStatus().mode === 'live',
      });
      // eslint-disable-next-line no-console
      console.log('[autopilot] true-wind TX online via NGT-1');

      const registry = getSharedDeviceRegistry();
      registeredTxer = (pgn) => ngt.txPgn(pgn);
      registry.registerTxer(registeredTxer);
      // Alerts registry shares the same txer for Alert Response (126984).
      createAlertsRegistry().setTxer(registeredTxer);
      // eslint-disable-next-line no-console
      console.log('[autopilot] device-registry refresh target = NGT-1');
    } else if (ydwg) {
      const registry = getSharedDeviceRegistry();
      registeredTxer = (pgn) => ydwg.txPgn(pgn);
      registry.registerTxer(registeredTxer);
      // 126984 is single-frame so YDWG can also send it.
      createAlertsRegistry().setTxer(registeredTxer);
      // eslint-disable-next-line no-console
      console.log('[autopilot] device-registry refresh target = YDWG (single-frame PGNs only)');
    }

    // Auto-discovery — for each newly-seen src that we don't yet have
    // Product Info for, send a per-target ISO Request. Only useful when a
    // txer is registered.
    let stopDiscoveryFn: (() => void) | null = null;
    if (registeredTxer) {
      stopDiscoveryFn = installDeviceDiscovery(bus);
      // eslint-disable-next-line no-console
      console.log('[autopilot] device-discovery online (per-target ISO Request on new sources)');
    }

    const teardownFn = async (): Promise<void> => {
      // Reverse order. Best-effort: log + swallow each step's error so
      // we still unwind the rest.
      const safe = async (label: string, fn: () => Promise<void>): Promise<void> => {
        try {
          await fn();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] live teardown ${label} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      if (stopDiscoveryFn) stopDiscoveryFn();
      if (registeredTxer) {
        getSharedDeviceRegistry().unregisterTxer(registeredTxer);
        // Drop the alerts txer too so unack'd Acknowledge clicks fail
        // cleanly with "no transmitter" rather than calling a stale ngt.
        createAlertsRegistry().setTxer(null);
      }
      if (stopTxFn) await safe('tx', stopTxFn);
      await safe('compute', stopCompute);
      if (stopLoggerFn) await safe('logger', stopLoggerFn);
      if (stopBridgeFn) await safe('bridge', stopBridgeFn);
      for (const s of stops.reverse()) await safe('port', s);
      if (baseTeardownHolder.current === teardownFn) baseTeardownHolder.current = null;
    };
    baseTeardownHolder.current = teardownFn;
    return {
      teardown: teardownFn,
      restart: liveFactory,
    };
  };
  return liveFactory;
}
