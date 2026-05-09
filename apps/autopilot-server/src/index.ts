import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@h6000/core';
import {
  Ngt1Driver,
  SerialPort0183Driver,
  ReplayDriver,
  runBridge,
  startSessionLogger,
  type WireDriver,
  type SessionLogger,
} from '@h6000/bridge';

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
const REPLAY_MODE: 'asap' | 'realtime' =
  process.env.REPLAY_MODE === 'asap' ? 'asap' : 'realtime';

async function main(): Promise<void> {
  const bus = getSharedBus();
  const drivers: WireDriver[] = [];
  const teardown: Array<() => Promise<void>> = [];

  // Replay mode short-circuits all live driver setup.
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

  if (drivers.length > 0) {
    const stop = await runBridge({ bus, drivers });
    teardown.push(stop);
  }

  // Optional session logger — independent of which drivers are active. In
  // replay mode we skip logging (don't re-record the same data).
  let logger: SessionLogger | null = null;
  if (SESSION_LOG_DIR && !REPLAY) {
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    logger = await startSessionLogger({
      drivers,
      dir: SESSION_LOG_DIR,
      sessionId,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[autopilot] session log: ${path.join(SESSION_LOG_DIR, sessionId + '.jsonl.gz')}`,
    );
    teardown.push(() => logger!.close());
  }

  // Start Next.js pointing at the @h6000/web package directory.
  const webDir = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../../packages/web',
  );
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
