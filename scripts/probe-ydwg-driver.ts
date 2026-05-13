/**
 * Live smoke test for YdwgRawTcpDriver.
 *
 * Usage:
 *   YDWG_HOST=192.168.1.100 YDWG_PORT=1457 \
 *     npx tsx scripts/probe-ydwg-driver.ts [durationSeconds]
 *
 * Streams raw CAN frames through the driver + decoder for `durationSeconds`
 * (default 10), then prints a summary: total frames, frames per PGN, unique
 * source addresses, decoded PGN samples (first one per PGN).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { YdwgRawTcpDriver, createYdwgTcpSocketFactory, decodeFrames } from '@g5000/bridge';

const host = process.env.YDWG_HOST ?? '192.168.1.100';
const port = Number(process.env.YDWG_PORT ?? 1457);
const durationSec = Number(process.argv[2] ?? 10);

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[probe] connecting to ${host}:${port} for ${durationSec}s…`);

  const driver = new YdwgRawTcpDriver({
    socketFactory: createYdwgTcpSocketFactory(host, port),
    backoffMs: { initialMs: 500, maxMs: 2000 },
  });

  let rawFrames = 0;
  let errors = 0;
  const framesByPgn = new Map<number, number>();
  const sourcesSeen = new Set<number>();
  const firstByPgn = new Map<number, Record<string, unknown>>();

  const decoded$ = decodeFrames(driver.rxCan);
  const rxSub = driver.rxCan.subscribe({
    next: (frame) => {
      rawFrames++;
      sourcesSeen.add(frame.id & 0xff);
    },
  });
  const decSub = decoded$.subscribe({
    next: (pgn) => {
      framesByPgn.set(pgn.pgn, (framesByPgn.get(pgn.pgn) ?? 0) + 1);
      if (!firstByPgn.has(pgn.pgn)) firstByPgn.set(pgn.pgn, pgn.fields);
    },
  });
  const healthSub = driver.health.subscribe({
    next: (h) => {
      errors = h.errorCount;
    },
  });

  await driver.start();
  await delay(durationSec * 1000);
  await driver.stop();
  rxSub.unsubscribe();
  decSub.unsubscribe();
  healthSub.unsubscribe();

  // eslint-disable-next-line no-console
  console.log(
    `\n[probe] summary after ${durationSec}s:\n` +
      `  raw CAN frames RX'd : ${rawFrames}\n` +
      `  decoder errors      : ${errors}\n` +
      `  unique src addrs    : ${[...sourcesSeen].sort((a, b) => a - b).join(', ') || '(none)'}\n` +
      `  PGNs seen           : ${framesByPgn.size}\n`,
  );
  const sorted = [...framesByPgn.entries()].sort((a, b) => b[1] - a[1]);
  for (const [pgn, n] of sorted.slice(0, 25)) {
    const sample = firstByPgn.get(pgn) ?? {};
    const keys = Object.keys(sample).slice(0, 4).join(', ');
    // eslint-disable-next-line no-console
    console.log(`  PGN ${pgn.toString().padStart(6)} × ${String(n).padStart(4)}  fields: ${keys}`);
  }
  if (sorted.length > 25) {
    // eslint-disable-next-line no-console
    console.log(`  … and ${sorted.length - 25} more PGNs`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[probe] fatal', err);
  process.exit(1);
});
