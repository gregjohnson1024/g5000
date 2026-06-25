/**
 * Ambient declaration for @canboat/canboatjs, which ships no TypeScript types.
 * We type only the subset we use; the full cast happens in decoder.ts.
 */
declare module '@canboat/canboatjs' {
  const canboat: Record<string, unknown>;
  export default canboat;
}

declare module '@canboat/canboatjs/dist/n2k-actisense.js' {
  /**
   * Parse Actisense binary frames from a Buffer.
   * - `data` is one or more complete framed packets starting with `0x10 0x02 0xd0`.
   * - `plainText: false` causes the callback to receive { pgn, length, data, coalesced } objects.
   *   `pgn` is the result of canId-decode: { pgn, src, dst, prio }.
   * - The function processes packets in a tight loop until the buffer is exhausted
   *   or a partial packet is detected at the end (in which case it returns silently).
   */
  export function readN2KActisense(
    data: Buffer,
    plainText: boolean,
    context: unknown,
    cb: (result: {
      pgn: { pgn: number; src: number; dst: number; prio: number };
      length: number;
      data: Buffer;
      coalesced: boolean;
    }) => void,
  ): unknown;

  /**
   * Encode a PGN payload as an Actisense binary frame (Buffer). Inverse of
   * readN2KActisense. Used in tests to generate fixtures.
   *
   * canboatjs 3.x takes the pgn metadata and the raw payload as two separate
   * args (2.x took a single `{ pgn, data, … }` object).
   */
  export function encodeN2KActisense(
    pgn: { pgn: number; prio?: number; dst?: number; src?: number; timestamp?: number },
    data: Buffer,
  ): Buffer;
}
