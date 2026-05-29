import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { getSharedBus, createAlarmsRegistry, setSharedAlarms } from '@g5000/core';
import { ConfigStore, setSharedConfigStore, loadAlarmsConfig, type AlarmsConfig } from '@g5000/db';
import {
  startPolarPipeline,
  startAlarmsPipeline,
  startSailCrossoverPipeline,
} from '@g5000/compute';
import { ReplayDriver, runBridge, createAisTargetsRegistry } from '@g5000/bridge';
import { migrateWaypointsJson } from './migrate-waypoints.js';
import { startShipLogAuto } from './ship-log-auto.js';
import { createSourceModeController } from './source-mode-controller.js';
import { installLogStream } from './log-stream-impl.js';
import { installObservedSourcesTracker } from './observed-sources.js';
import { startWatchdog } from './sd-notify.js';
import { wireAlarmsHistory } from './alarms-history.js';
import { createLiveFactory, createDemoFactory, type BaseTeardownHolder } from './live-factory.js';
import { startRaceSubsystem } from './race-subsystem.js';
import { startHlink, startWebServer } from './server-setup.js';

const HTTP_PORT = Number(process.env.PORT ?? 3000);
const SESSION_LOG_DIR = process.env.SESSION_LOG_DIR ?? null;
const REPLAY = process.env.REPLAY ?? null;
const REPLAY_MODE: 'asap' | 'realtime' = process.env.REPLAY_MODE === 'asap' ? 'asap' : 'realtime';
const CONFIG_DB_PATH = process.env.CONFIG_DB ?? './data/config.db';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const HLINK_ENABLED = process.env.HLINK_ENABLED !== '0';
const HLINK_PORT = Number(process.env.HLINK_PORT ?? 5050);

const SOCKETCAN_ROOT = process.env.G5000_ROUTER_ROOT ?? path.join(homedir(), '.g5000-router');

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
  // One-time migration: import legacy ~/.g5000-router/waypoints.json into
  // ConfigStore if the store is empty and the file exists.
  await migrateWaypointsJson(store, path.join(SOCKETCAN_ROOT, 'waypoints.json'));
  // eslint-disable-next-line no-console
  console.log(`[autopilot] config db: ${CONFIG_DB_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`[g5000] active boat: ${process.env.G5000_BOAT_ID ?? 'sula'}`);

  // --- Safety alarms (g5000-derived) ---
  // Built right after ConfigStore so API routes that touch the registry or
  // its config (e.g. /api/alarms/*) always find both wired. Disposed in the
  // shutdown handler below.
  const alarmsRegistry = createAlarmsRegistry();
  setSharedAlarms(alarmsRegistry);

  // Wrap registry mutators so each fire/clear/ack transition also appends to
  // the alarms_history table (best-effort; a DB hiccup never fails an alarm).
  wireAlarmsHistory({ store, registry: alarmsRegistry });

  const initialAlarmsConfig = await loadAlarmsConfig(store);
  const alarmsConfigRef: { current: AlarmsConfig } = { current: initialAlarmsConfig };
  const alarmsPipelineHandle = startAlarmsPipeline(bus, alarmsRegistry, alarmsConfigRef);
  // Expose the ref so API routes that update config (e.g. PUT /api/alarms/config)
  // can swap it without restarting the predicates.
  (
    globalThis as { __g5000_alarms_config_ref__?: typeof alarmsConfigRef }
  ).__g5000_alarms_config_ref__ = alarmsConfigRef;
  teardown.push(async () => alarmsPipelineHandle.dispose());
  // eslint-disable-next-line no-console
  console.log('[autopilot] alarms pipeline online');

  // AIS targets registry — proactively create so the eviction loop has
  // something to operate on even before the first PGN arrives. The bridge
  // (live) and demo-injector both upsert into the same singleton.
  const aisRegistry = createAisTargetsRegistry();
  const AIS_MAX_AGE_MS = 5 * 60_000;
  const aisEvictTimer = setInterval(() => {
    aisRegistry.evictStale(AIS_MAX_AGE_MS);
  }, 15_000);
  teardown.push(async () => clearInterval(aisEvictTimer));

  // Ship's log hourly auto-logger. Persists a position snapshot every hour
  // so the narrative log doesn't depend on someone remembering to write
  // anything down. Manual entries are written via /api/log POST.
  const activeBoatId = process.env.G5000_BOAT_ID ?? 'sula';
  const shipLogAuto = startShipLogAuto({ bus, store, boatId: activeBoatId });
  teardown.push(async () => shipLogAuto.dispose());
  // eslint-disable-next-line no-console
  console.log("[autopilot] ship's log auto-logger online");

  const sessionsDir = SESSION_LOG_DIR ?? path.join(dataDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const sourceModeController = createSourceModeController({ bus, sessionsDir });

  // Track the most-recently-built base-source teardown for graceful
  // shutdown. The controller owns the handle internally; we shadow its
  // teardown here so SIGINT can unwind the live/demo source without
  // needing a new controller method. Each factory updates this on entry;
  // teardown clears it.
  const baseTeardownHolder: BaseTeardownHolder = { current: null };

  // Demo factory — synthetic samples published directly to the bus. The
  // true-wind compute pipeline is NOT started here (demo publishes
  // calibrated wind directly; running the pipeline would overwrite it).
  const demoFactory = createDemoFactory({ bus, baseTeardownHolder });

  // Live factory — open NGT-1 + 0183 ports, run bridge, start session
  // logger + true-wind compute + true-wind TX. The composite teardown
  // unwinds in reverse start order.
  const liveFactory = createLiveFactory({ bus, store, sourceModeController, baseTeardownHolder });

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

    // Sail-crossover pipeline — publishes sail.recommendation based on the
    // active crossover map + current TWS/TWA. Consumes calibrated wind off
    // the bus, same as the polar pipeline, so it runs in live and demo.
    const stopSailCrossover = startSailCrossoverPipeline({
      bus,
      sails$: store.sails$,
      settings$: store.crossoverSettings$,
    });
    teardown.push(async () => stopSailCrossover.unsubscribe());
    // eslint-disable-next-line no-console
    console.log('[autopilot] sail-crossover pipeline online');

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
      if (baseTeardownHolder.current) {
        try {
          await baseTeardownHolder.current();
        } catch {
          /* ignore */
        }
        baseTeardownHolder.current = null;
      }
    });
  }

  // --- Race state + pipeline ---
  // Runs regardless of source mode (live, demo, or replay) so that
  // replay-driven integration tests can exercise race compute.
  const stopRaceSubsystem = await startRaceSubsystem({ bus, store });
  teardown.push(stopRaceSubsystem);

  // 2b. H-LINK TCP server — B&G ASCII protocol over TCP, read-only.
  //     Exposes bus data to tactical-sailing software (Deckman, Expedition
  //     plugins, etc.) by mimicking the H5000 CPU's serial interface.
  //     Spec on serial is 115200/8N1; we use TCP because every modern client
  //     supports it just as well.
  if (HLINK_ENABLED) {
    const hlink = startHlink({ bus, store, port: HLINK_PORT });
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
  const server = await startWebServer({ webDir, port: HTTP_PORT });

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
