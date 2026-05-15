import type { Bus } from '@g5000/core';
import { getPgnFirehose } from '@g5000/core';
import { mergeMap, from, share, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';
import { mapSentenceToSamples } from './nmea0183/channel-mapper.js';
import { getSharedDeviceRegistry } from './index.js';
import { handleAisPgn, isAisPgn } from './ais/ais-handler.js';
import { handleAlertPgn } from './alerts/handler.js';
import { registerAutopilotTxIfEnabled } from './autopilot-tx-impl.js';

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

  // AP TX is disabled by default. Mac dev enables it by setting
  // G5000_ENABLE_AP_TX=1 before launching the autopilot server.
  if (drivers.length > 0) {
    registerAutopilotTxIfEnabled(drivers[0]!);
  }

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

    // Firehose: every decoded PGN also goes to the shared subject so
    // sniffers can subscribe without plumbing through the bridge. See
    // packages/core/src/pgn-firehose.ts.
    const firehose = getPgnFirehose();
    subs.push(
      decoded$.subscribe({
        next: (pgn) =>
          firehose.next({
            pgn: pgn.pgn,
            src: pgn.src,
            prio: pgn.prio,
            dst: pgn.dst,
            fields: pgn.fields,
            rxTimestamp: pgn.rxTimestamp,
          }),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] firehose pipeline error', err);
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

    // Alerts path: standard 126983/126985 plus Navico's proprietary
    // 130850 (Simnet Event Command: AP command) — B&G/Lowrance gear
    // doesn't follow the N2K alert protocol, so we treat
    // non-standard Event IDs on 130850 as synthetic alarms. /api/alerts
    // reads from the shared registry; the helm UI's Clear button
    // either sends 126984 for standard alerts or just removes the
    // local snapshot for synthetic ones (Navico doesn't speak
    // Alert Response).
    subs.push(
      decoded$.subscribe({
        next: (pgn) => {
          if (pgn.pgn === 126983 || pgn.pgn === 126985 || pgn.pgn === 130850) {
            handleAlertPgn(pgn);
          }
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] alerts pipeline error', err);
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
