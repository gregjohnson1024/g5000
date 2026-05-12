import type { Bus } from '@g5000/core';
import { mergeMap, from, share, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';
import { mapSentenceToSamples } from './nmea0183/channel-mapper.js';
import { getSharedDeviceRegistry } from './index.js';
import { handleAisPgn, isAisPgn } from './ais/ais-handler.js';

export interface BridgeOptions {
  bus: Bus;
  drivers: WireDriver[];
}

/**
 * Wires each WireDriver's CAN and 0183 streams through their respective
 * decoders/mappers and publishes resulting Samples on the shared Bus.
 * Also feeds every decoded CAN PGN into the device registry so the
 * /devices page can show what's on the bus.
 */
export async function runBridge(opts: BridgeOptions): Promise<() => Promise<void>> {
  const { bus, drivers } = opts;
  const registry = getSharedDeviceRegistry();
  await Promise.all(drivers.map((d) => d.start()));

  const subs: Subscription[] = [];

  for (const driver of drivers) {
    // Decode once and share so both pipelines see the same stream
    // (avoid running canboatjs twice per frame).
    const decoded$ = driver.rxCan.pipe(decode(), share());

    // Existing path: PGN → channel mapper → bus.
    subs.push(
      decoded$.pipe(mergeMap((pgn) => from(mapPgnToSamples(pgn)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] CAN pipeline error (subscription terminated)', err);
        },
      }),
    );

    // New path: every decoded PGN goes to the device registry.
    subs.push(
      decoded$.subscribe({
        next: (pgn) => registry.observe(pgn),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] device-registry pipeline error', err);
        },
      }),
    );

    // AIS path: AIS PGNs feed the per-MMSI targets registry rather than the
    // bus, so we don't get per-vessel channel proliferation.
    subs.push(
      decoded$.subscribe({
        next: (pgn) => {
          if (isAisPgn(pgn.pgn)) handleAisPgn(pgn.pgn, pgn.fields);
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] AIS pipeline error', err);
        },
      }),
    );

    // 0183 path (unchanged).
    subs.push(
      driver.rx0183.pipe(mergeMap((s) => from(mapSentenceToSamples(s)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] 0183 pipeline error (subscription terminated)', err);
        },
      }),
    );
  }

  return async () => {
    for (const s of subs) s.unsubscribe();
    await Promise.all(drivers.map((d) => d.stop()));
  };
}
