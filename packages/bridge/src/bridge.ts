import type { Bus } from '@h6000/core';
import { mergeMap, from, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';
import { mapSentenceToSamples } from './nmea0183/channel-mapper.js';

export interface BridgeOptions {
  bus: Bus;
  drivers: WireDriver[];
}

/**
 * Wires each WireDriver's CAN and 0183 streams through their respective
 * decoders/mappers and publishes the resulting Samples on the shared Bus.
 * Returns a stop() function that disconnects the drivers and unsubscribes
 * the pipeline.
 */
export async function runBridge(opts: BridgeOptions): Promise<() => Promise<void>> {
  const { bus, drivers } = opts;
  await Promise.all(drivers.map((d) => d.start()));

  const subs: Subscription[] = [];

  for (const driver of drivers) {
    subs.push(
      driver.rxCan
        .pipe(
          decode(),
          mergeMap((pgn) => from(mapPgnToSamples(pgn))),
        )
        .subscribe({
          next: (sample) => bus.publish(sample),
          error: (err) => {
            // The current pipeline terminates this driver's subscription on
            // first error. For Phase 0a (stable canboatjs, well-defined NGT-1
            // framing) this is acceptable; restart the process to recover.
            // Future plans should add catchError + resubscribe.
            // eslint-disable-next-line no-console
            console.error('[bridge] CAN pipeline error (subscription terminated)', err);
          },
        }),
    );
    subs.push(
      driver.rx0183
        .pipe(mergeMap((s) => from(mapSentenceToSamples(s))))
        .subscribe({
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
