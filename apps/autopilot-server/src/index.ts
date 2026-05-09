import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@h6000/core';
import { Ngt1Driver, runBridge } from '@h6000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const DEV = process.env.NODE_ENV !== 'production';

async function main(): Promise<void> {
  const bus = getSharedBus();

  // 1. Start bridge if a real serial port exists. Otherwise log and continue
  //    so the web UI is still usable (showing zero channels, useful for
  //    shoreside development).
  const skipBridge = process.env.SKIP_BRIDGE === '1';
  let stopBridge: (() => Promise<void>) | null = null;
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
      const driver = new Ngt1Driver({ source: port });
      stopBridge = await runBridge({ bus, drivers: [driver] });
      // eslint-disable-next-line no-console
      console.log(`[autopilot] bridge online via ${SERIAL_PATH}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[autopilot] bridge offline (${err instanceof Error ? err.message : String(err)}); web UI will be empty until a serial device is available`,
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('[autopilot] SKIP_BRIDGE=1 set; not opening serial port');
  }

  // 2. Start Next.js pointing at the @h6000/web package directory.
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

  // 3. Graceful shutdown.
  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    server.close();
    if (stopBridge) await stopBridge();
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
