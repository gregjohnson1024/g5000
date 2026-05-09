import { SerialPort } from 'serialport';
import { Bus } from '@h6000/core';
import { Ngt1Driver, runBridge } from '@h6000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[autopilot] opening ${SERIAL_PATH} @ ${BAUD_RATE}`);

  const port = new SerialPort({
    path: SERIAL_PATH,
    baudRate: BAUD_RATE,
    autoOpen: false,
  });

  await new Promise<void>((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });

  const bus = new Bus();
  const driver = new Ngt1Driver({ source: port });
  const stop = await runBridge({ bus, drivers: [driver] });

  // Phase 0a: print every sample to stdout so we can confirm decode works.
  bus.subscribe('**', (s) => {
    // eslint-disable-next-line no-console
    console.log(
      `[${new Date(Number(s.t_ns / 1_000_000n)).toISOString()}] ${s.channel} = ${JSON.stringify(s.value)} (src=${s.source})`,
    );
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    await stop();
    port.close();
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
