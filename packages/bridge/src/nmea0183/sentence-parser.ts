/**
 * Parsed NMEA 0183 sentence. Field interpretation is left to the channel
 * mapper — this layer only handles framing, checksum validation, and
 * tokenization.
 */
export interface ParsedSentence {
  /** Two-character talker ID (e.g. "WI" for wind instrument, "GP" for GPS). */
  talker: string;
  /** Three-character sentence type (e.g. "MWV", "VHW", "HDG"). */
  type: string;
  /** Comma-separated fields between the address and the checksum. */
  fields: readonly string[];
}

export type ParseResult =
  | { ok: true; sentence: ParsedSentence }
  | { ok: false; error: string };

/**
 * Parse one NMEA 0183 ASCII sentence. Returns `{ok: true, sentence}` if the
 * line is well-formed and the checksum matches, `{ok: false, error}` otherwise.
 *
 * Format (per IEC 61162-1):
 *
 *   $<talker><type>,<field>,<field>,...*<checksum><CR><LF>
 *
 * Checksum is the XOR of every byte between `$` and `*` exclusive, in hex.
 */
export function parseSentence(line: string): ParseResult {
  const trimmed = line.replace(/[\r\n]+$/, '');
  if (!trimmed.startsWith('$')) {
    return { ok: false, error: 'missing leading $' };
  }
  const star = trimmed.lastIndexOf('*');
  if (star < 0 || trimmed.length - star !== 3) {
    return { ok: false, error: 'missing or malformed checksum' };
  }
  const body = trimmed.slice(1, star);
  const declared = trimmed.slice(star + 1).toUpperCase();
  const computed = computeChecksum(body).toUpperCase();
  if (declared !== computed) {
    return {
      ok: false,
      error: `checksum mismatch: declared ${declared}, computed ${computed}`,
    };
  }
  const parts = body.split(',');
  const head = parts[0] ?? '';
  if (head.length !== 5) {
    return { ok: false, error: `address must be 5 chars, got "${head}"` };
  }
  return {
    ok: true,
    sentence: {
      talker: head.slice(0, 2),
      type: head.slice(2),
      fields: parts.slice(1),
    },
  };
}

function computeChecksum(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) {
    cs ^= body.charCodeAt(i);
  }
  return cs.toString(16).padStart(2, '0');
}
