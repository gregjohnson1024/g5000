import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@g5000/core';
import type { BaseSourceHandle } from '@g5000/core';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import { startTrueWindPipeline, startPolarPipeline } from '@g5000/compute';
import {
  Ngt1Driver,
  SerialPort0183Driver,
  ReplayDriver,
  YdwgRawTcpDriver,
  createYdwgTcpSocketFactory,
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
import { createSourceModeController } from './source-mode-controller.js';
import { installLogStream } from './log-stream-impl.js';
import { startHlinkServer } from './hlink/server.js';
import { installObservedSourcesTracker } from './observed-sources.js';
import { installDeviceDiscovery } from './device-discovery.js';
import { notifyReady, startWatchdog } from './sd-notify.js';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const DEV = process.env.NODE_ENV !== 'production';
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
const REPLAY = process.env.REPLAY ?? null;
const REPLAY_MODE: 'asap' | 'realtime' = process.env.REPLAY_MODE === 'asap' ? 'asap' : 'realtime';
const CONFIG_DB_PATH = process.env.CONFIG_DB ?? './data/config.db';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const SKIP_BRIDGE = process.env.SKIP_BRIDGE === '1';
const HLINK_ENABLED = process.env.HLINK_ENABLED !== '0';
const HLINK_PORT = Number(process.env.HLINK_PORT ?? 5050);

async function main(): Promise<void> {
  const bus = getSharedBus();
  installLogStream();
  const teardown: Array<() => Promise<void>> = [];

  // Observed-sources tracker — records which (channel, source) pairs have
  // recently published, so the /sources UI page can show competing
  // publishers. Installed before any source so we don't miss early samples.
  const observed = installObservedSourcesTracker(bus);
  teardown.push(async () => observed.teardown());

  // 0. Open ConfigStore so any code path (web routes, compute pipeline) can
  //    resolve it. This must precede driver setup — even if drivers fail,
  //    the web UI should still work for cal-table editing.
  const dataDir = path.dirname(CONFIG_DB_PATH);
  await mkdir(dataDir, { recursive: true });
  const store = await ConfigStore.open(CONFIG_DB_PATH);
  setSharedConfigStore(store);
  teardown.push(() => store.close());
  // eslint-disable-next-line no-console
  console.log(`[autopilot] config db: ${CONFIG_DB_PATH}`);

  const sessionsDir = SESSION_LOG_DIR ?? path.join(dataDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const sourceModeController = createSourceModeController({ bus, sessionsDir });

  // Track the most-recently-built base-source teardown for graceful
  // shutdown. The controller owns the handle internally; we shadow its
  // teardown here so SIGINT can unwind the live/demo source without
  // needing a new controller method. Each factory updates this on entry;
  // teardown clears it.
  let currentBaseTeardown: (() => Promise<void>) | null = null;

  // Demo factory — synthetic samples published directly to the bus. The
  // true-wind compute pipeline is NOT started here (demo publishes
  // calibrated wind directly; running the pipeline would overwrite it).
  const demoFactory = async (): Promise<BaseSourceHandle> => {
    const stopDemo = startDemoInjector(bus);
    // eslint-disable-next-line no-console
    console.log('[autopilot] demo mode — synthetic samples publishing to the bus');
    const teardownFn = async (): Promise<void> => {
      stopDemo();
      if (currentBaseTeardown === teardownFn) currentBaseTeardown = null;
    };
    currentBaseTeardown = teardownFn;
    return {
      teardown: teardownFn,
      restart: demoFactory,
    };
  };

  // Live factory — open NGT-1 + 0183 ports, run bridge, start session
  // logger + true-wind compute + true-wind TX. The composite teardown
  // unwinds in reverse start order.
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
      if (currentBaseTeardown === teardownFn) currentBaseTeardown = null;
    };
    currentBaseTeardown = teardownFn;
    return {
      teardown: teardownFn,
      restart: liveFactory,
    };
  };

  // 1. REPLAY env-var boot path — bypasses factories, runs a single
  //    replay-from-boot. Preserved for CLI ergonomics; live↔demo toggle
  //    not available in this mode (the user can stopReplay via /api).
  if (REPLAY) {
    const driver = new ReplayDriver({ filePath: REPLAY, mode: REPLAY_MODE });
    const stopBridge = await runBridge({ bus, drivers: [driver] });
    teardown.push(stopBridge);
    // eslint-disable-next-line no-console
    console.log(`[autopilot] replay mode (${REPLAY_MODE}): ${REPLAY}`);
    // Polar pipeline still runs in replay so /polars works against replayed data.
    const stopPolarPipeline = await startPolarPipeline({ bus, configStore: store });
    teardown.push(stopPolarPipeline);
    // eslint-disable-next-line no-console
    console.log('[autopilot] polar pipeline online');
  } else {
    // 2. Register factories with the controller and boot into the requested mode.
    sourceModeController.setBaseSourceFactories({ live: liveFactory, demo: demoFactory });
    await sourceModeController.setLiveOrDemo(DEMO_MODE ? 'demo' : 'live');
    // eslint-disable-next-line no-console
    console.log(
      `[autopilot] source mode: ${sourceModeController.getStatus().mode} (sessions dir: ${sessionsDir})`,
    );
    const errAtBoot = sourceModeController.getStatus().errorMessage;
    if (errAtBoot) {
      // eslint-disable-next-line no-console
      console.warn(`[autopilot] source-mode boot warning: ${errAtBoot}`);
    }

    // Polar performance pipeline — always on (consumes calibrated wind
    // from either the demo injector or the true-wind compute pipeline).
    const stopPolarPipeline = await startPolarPipeline({ bus, configStore: store });
    teardown.push(stopPolarPipeline);
    // eslint-disable-next-line no-console
    console.log('[autopilot] polar pipeline online');

    // Tear down whatever base source the controller currently owns on shutdown.
    teardown.push(async () => {
      const st = sourceModeController.getStatus();
      if (st.mode === 'replay') {
        // Replay teardown is owned by the controller via stopReplay.
        try {
          await sourceModeController.stopReplay();
        } catch {
          /* ignore */
        }
      }
      if (currentBaseTeardown) {
        try {
          await currentBaseTeardown();
        } catch {
          /* ignore */
        }
        currentBaseTeardown = null;
      }
    });
  }

  // 2b. H-LINK TCP server — B&G ASCII protocol over TCP, read-only.
  //     Exposes bus data to tactical-sailing software (Deckman, Expedition
  //     plugins, etc.) by mimicking the H5000 CPU's serial interface.
  //     Spec on serial is 115200/8N1; we use TCP because every modern client
  //     supports it just as well.
  if (HLINK_ENABLED) {
    const hlink = startHlinkServer({
      bus,
      port: HLINK_PORT,
      host: '0.0.0.0',
      // Cheap sync read of the current damping config on every sample.
      // ConfigStore keeps a BehaviorSubject under the hood; `.value` access.
      getDamping: () => store.getDampingConfig(),
    });
    try {
      await hlink.listening;
      // eslint-disable-next-line no-console
      console.log(`[autopilot] H-LINK server on tcp://0.0.0.0:${HLINK_PORT}`);
      teardown.push(hlink.teardown);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[autopilot] H-LINK server failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Start Next.js pointing at the @g5000/web package directory.
  const webDir = path.resolve(fileURLToPath(import.meta.url), '../../../../packages/web');
  const app = next({ dev: DEV, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(HTTP_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[autopilot] web UI on http://0.0.0.0:${HTTP_PORT}`);
    // Tell systemd we're done initialising. Required under Type=notify;
    // no-op when run standalone. Sent here (not earlier) so systemd
    // doesn't flip to "active" until the HTTP listener actually exists.
    notifyReady();
    // Wake the track recorder. It only starts on the first hit to
    // /api/tracks/active — without this kick, a service restart leaves
    // it idle until someone opens the chart page, and the boat
    // moves with no track points appended. Fire-and-forget; failures
    // are non-fatal (next page visit will wake it anyway).
    setTimeout(() => {
      fetch(`http://127.0.0.1:${HTTP_PORT}/api/tracks/active`)
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('[autopilot] track recorder kicked');
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] track recorder kick failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }, 2000);
  });

  // Watchdog heartbeat. Fires every WatchdogSec/2 if systemd asked us
  // to. If the event loop blocks long enough that we miss a ping,
  // systemd SIGKILLs us and `Restart=on-failure` brings us back.
  const stopWatchdog = startWatchdog();
  teardown.push(async () => stopWatchdog());

  // Graceful shutdown — reverse the start order.
  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    server.close();
    for (const t of teardown.reverse()) {
      try {
        await t();
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[autopilot] fatal', err);
  process.exit(1);
});
