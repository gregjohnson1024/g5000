import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@g5000/core';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import { startTrueWindPipeline } from '@g5000/compute';
import {
  Ngt1Driver,
  SerialPort0183Driver,
  ReplayDriver,
  runBridge,
  startSessionLogger,
  startTrueWindTx,
  type WireDriver,
  type SessionLogger,
} from '@g5000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const DEV = process.env.NODE_ENV !== 'production';
const NMEA0183_PATHS = (process.env.NMEA0183_PATHS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const SESSION_LOG_DIR = process.env.SESSION_LOG_DIR ?? null;
const REPLAY = process.env.REPLAY ?? null;
const REPLAY_MODE: 'asap' | 'realtime' = process.env.REPLAY_MODE === 'asap' ? 'asap' : 'realtime';
const CONFIG_DB_PATH = process.env.CONFIG_DB ?? './data/config.db';

async function main(): Promise<void> {
  const bus = getSharedBus();
  const drivers: WireDriver[] = [];
  const teardown: Array<() => Promise<void>> = [];

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

  // 1. Driver setup (live or replay).
  if (REPLAY) {
    const driver = new ReplayDriver({ filePath: REPLAY, mode: REPLAY_MODE });
    drivers.push(driver);
    // eslint-disable-next-line no-console
    console.log(`[autopilot] replay mode (${REPLAY_MODE}): ${REPLAY}`);
  } else {
    const skipBridge = process.env.SKIP_BRIDGE === '1';

    if (!skipBridge) {
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
        // eslint-disable-next-line no-console
        console.log(`[autopilot] NGT-1 online via ${SERIAL_PATH}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[autopilot] NGT-1 offline (${err instanceof Error ? err.message : String(err)})`,
        );
      }

      for (const [i, p183] of NMEA0183_PATHS.entries()) {
        try {
          const port = new SerialPort({
            path: p183,
            baudRate: 4800,
            autoOpen: false,
          });
          await new Promise<void>((resolve, reject) => {
            port.open((err) => (err ? reject(err) : resolve()));
          });
          drivers.push(new SerialPort0183Driver({ source: port, port: i + 1 }));
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
  }

  // 2. Bridge orchestrator.
  if (drivers.length > 0) {
    const stop = await runBridge({ bus, drivers });
    teardown.push(stop);
  }

  // 3. Optional session logger (skipped in replay mode).
  let logger: SessionLogger | null = null;
  if (SESSION_LOG_DIR && !REPLAY) {
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    logger = await startSessionLogger({
      drivers,
      dir: SESSION_LOG_DIR,
      sessionId,
    });
    // eslint-disable-next-line no-console
    console.log(`[autopilot] session log: ${path.join(SESSION_LOG_DIR, sessionId + '.jsonl.gz')}`);
    teardown.push(() => logger!.close());
  }

  // 4. True-wind compute pipeline (subscribes to bus + ConfigStore,
  //    publishes wind.true.calibrated.* back to the bus).
  const stopCompute = await startTrueWindPipeline({
    bus,
    configStore: store,
  });
  teardown.push(stopCompute);
  // eslint-disable-next-line no-console
  console.log('[autopilot] true-wind compute pipeline online');

  // 5. True-wind TX wiring. Picks the first driver that supports txPgn —
  //    only the NGT-1 in Phase 0a (others throw). Skipped in replay mode
  //    (we don't transmit when reading from a recorded session).
  const ngt = drivers.find((d) => d instanceof Ngt1Driver);
  if (ngt && !REPLAY) {
    const stopTx = await startTrueWindTx({ bus, driver: ngt });
    teardown.push(stopTx);
    // eslint-disable-next-line no-console
    console.log('[autopilot] true-wind TX online via NGT-1');
  }

  // 6. Start Next.js pointing at the @g5000/web package directory.
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
  });

  // Graceful shutdown — reverse the start order.
  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    server.close();
    for (const t of teardown.reverse()) await t();
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
