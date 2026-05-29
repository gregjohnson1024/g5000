import { BehaviorSubject } from 'rxjs';
import type { RawCanFrame, DriverHealth, OutgoingPgn } from './wire-driver.js';
import { encodePgnToCanFrames } from './tx/fast-packet.js';

/**
 * Construct the per-driver health BehaviorSubject seeded with the canonical
 * "not yet connected" defaults. Every WireDriver starts from the same state:
 * disconnected, no traffic, no errors. Shared so the seed lives in one place.
 */
export function createHealthSubject(): BehaviorSubject<DriverHealth> {
  return new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
}

/**
 * Encode a typed PGN into ordered CAN frames and transmit each one in turn
 * via the driver's own `txCan`. Short PGNs yield a single frame; Fast Packet
 * PGNs yield multiple frames with the NMEA-2000 order byte already set, sent
 * in order. Shared by the raw-CAN drivers (YDWG RAW TCP, SocketCAN) so the
 * encode-then-split-then-send loop lives in one place.
 */
export async function txPgnViaFrames(
  txCan: (frame: RawCanFrame) => Promise<void>,
  pgn: OutgoingPgn,
): Promise<void> {
  const frames = encodePgnToCanFrames(pgn);
  for (const frame of frames) {
    await txCan(frame);
  }
}
