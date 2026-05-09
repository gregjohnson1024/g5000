import { Subject, throttleTime, type Subscription } from 'rxjs';
import type { Bus } from '@h6000/core';
import type { WireDriver } from '../wire-driver.js';

export interface TrueWindTxOptions {
  bus: Bus;
  driver: WireDriver;
  /** Minimum interval between transmits, ms. Default 200 (5 Hz). */
  throttleMs?: number;
}

/**
 * Subscribe to `wind.true.calibrated.{speed,angle}` on the bus and emit
 * PGN 130306 frames to the wire-driver at most once every `throttleMs`.
 *
 * The PGN encodes Reference = "True (boat referenced)" which is what the
 * H5000 / Zeus SR family expects for TWS/TWA values referenced to the boat
 * (not ground-true wind direction — that's "True (ground referenced)").
 */
export async function startTrueWindTx(
  opts: TrueWindTxOptions,
): Promise<() => Promise<void>> {
  const { bus, driver } = opts;
  const throttleMs = opts.throttleMs ?? 200;

  let speed: number | undefined;
  let angle: number | undefined;
  const trigger = new Subject<void>();

  const subs = [
    bus.subscribe('wind.true.calibrated.speed', (s) => {
      if (s.value.kind === 'scalar') {
        speed = s.value.value;
        trigger.next();
      }
    }),
    bus.subscribe('wind.true.calibrated.angle', (s) => {
      if (s.value.kind === 'scalar') {
        angle = s.value.value;
        trigger.next();
      }
    }),
  ];

  const rxSub: Subscription = trigger
    .pipe(
      throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
    )
    .subscribe(() => {
      if (speed === undefined || angle === undefined) return;
      void driver.txPgn({
        pgn: 130306,
        prio: 2,
        dst: 255,
        fields: {
          'Wind Speed': speed,
          'Wind Angle': angle,
          Reference: 'True (boat referenced)',
        },
      });
    });

  return async () => {
    for (const u of subs) u();
    rxSub.unsubscribe();
  };
}
