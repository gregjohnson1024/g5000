import { Subject, type Observable } from 'rxjs';

/**
 * Shared firehose of decoded PGNs.
 *
 * Channel-mapped data flows through the bus; alerts flow through the
 * alerts registry — but neither exposes the full raw PGN stream. The
 * firehose adds a tap so feature code (sniffers, debuggers, future
 * passive listeners) can subscribe to every decoded frame without
 * having to plumb through the bridge.
 *
 * Wired in `packages/bridge/src/bridge.ts`: every decoded PGN gets
 * `next()`-ed here right after channel mapping. Subscribers should
 * filter by `pgn` themselves — there can be hundreds of frames/sec on
 * an active bus.
 */
export interface FirehosePgn {
  pgn: number;
  src: number;
  prio?: number;
  dst?: number;
  /** canboat field name → decoded value. */
  fields: Record<string, unknown>;
  /** ns since Unix epoch. */
  rxTimestamp: bigint;
}

declare const globalThis: { __g5000_pgn_firehose__?: Subject<FirehosePgn> };

export function getPgnFirehose(): Subject<FirehosePgn> {
  if (!globalThis.__g5000_pgn_firehose__) {
    globalThis.__g5000_pgn_firehose__ = new Subject();
  }
  return globalThis.__g5000_pgn_firehose__;
}

export function pgnFirehose$(): Observable<FirehosePgn> {
  return getPgnFirehose().asObservable();
}
