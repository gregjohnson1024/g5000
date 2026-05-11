/**
 * H-LINK wire protocol — checksum + line parser + outgoing frame formatter.
 *
 * H-LINK is B&G's ASCII protocol for the H5000 CPU. Lines look like:
 *
 *     #OV,1,1,73*12\r\n
 *
 * The trailing `*XX` is the XOR-8 checksum (uppercase hex) of every byte
 * before `*`. We support a small subset of commands — see `parseHlinkLine`.
 */

/** XOR-8 checksum of `s`, formatted as 2-char uppercase hex (`"0A"` etc.). */
export function hlinkChecksum(s: string): string {
  let x = 0;
  for (let i = 0; i < s.length; i++) x ^= s.charCodeAt(i) & 0xff;
  return x.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Tagged union of parsed commands. Every variant carries enough info for
 * the server's `handle()` dispatcher; bad / unknown / bad-checksum lines
 * become `{ kind: 'ignore' }` so the server can drop them silently.
 */
export type HlinkCommand =
  | { kind: 'ov-once'; fn: number }
  | { kind: 'ov-enable'; fn: number }
  | { kind: 'ov-disable'; fn: number }
  | { kind: 'ol-once' }
  | { kind: 'ol-enable' }
  | { kind: 'ol-disable' }
  | { kind: 'os-start' }
  | { kind: 'os-stop' }
  | { kind: 'ignore'; reason: string };

/**
 * Parse one H-LINK line (with or without trailing \r\n).
 *
 * Behaviour:
 *  - Lines NOT starting with `#` (or `V`/`P`, which are server-output) → ignore.
 *  - Lines with a `*XX` checksum: verify it; mismatch → ignore.
 *  - Lines without a `*XX` checksum: accept (lenient — some tactical
 *    software omits the checksum even though the spec requires it; we
 *    don't disconnect for it).
 *  - Empty fields are tolerated wherever the spec allows them
 *    (`#OV,,1,65` is valid; the FastNet node number is ignored).
 *  - Unknown #-commands (e.g. `#IV`, `#TO`) → ignore (silently, per spec
 *    direction in the task).
 */
export function parseHlinkLine(line: string): HlinkCommand {
  // Strip CR/LF.
  let body = line.replace(/[\r\n]+$/, '');
  if (body.length === 0) return { kind: 'ignore', reason: 'empty' };

  // Optional checksum: `*XX` at the end.
  const starIdx = body.lastIndexOf('*');
  if (starIdx >= 0 && body.length - starIdx === 3) {
    const expected = body.slice(starIdx + 1).toUpperCase();
    const payload = body.slice(0, starIdx);
    const actual = hlinkChecksum(payload);
    if (expected !== actual) {
      return { kind: 'ignore', reason: `bad checksum (got ${expected}, want ${actual})` };
    }
    body = payload;
  } else if (starIdx >= 0) {
    // A `*` without exactly 2 hex chars after it — malformed.
    return { kind: 'ignore', reason: 'malformed checksum' };
  }

  if (!body.startsWith('#')) {
    return { kind: 'ignore', reason: 'no #-prefix' };
  }

  const fields = body.slice(1).split(',');
  const cmd = fields[0];

  if (cmd === 'OV') {
    // #OV,n,m,f       — one-shot read
    // #OV,n,m,f,o     — enable/disable streaming (o=1 enable, o=0 disable)
    // n is the FastNet node number; we ignore it.
    // m is the message type; we accept anything (the table-vs-example
    //   conflict in the manual is unresolved; clients tend to send 1).
    if (fields.length < 4 || fields.length > 5) {
      return { kind: 'ignore', reason: 'OV wrong arity' };
    }
    const fnField = fields[3] ?? '';
    const fn = parseInt(fnField, 10);
    if (!Number.isFinite(fn)) {
      return { kind: 'ignore', reason: 'OV bad fn' };
    }
    if (fields.length === 4) {
      return { kind: 'ov-once', fn };
    }
    const onOff = fields[4];
    if (onOff === '1') return { kind: 'ov-enable', fn };
    if (onOff === '0') return { kind: 'ov-disable', fn };
    return { kind: 'ignore', reason: 'OV bad on/off' };
  }

  if (cmd === 'OL') {
    // #OL          — one-shot position read
    // #OL,1        — enable streaming
    // #OL,0        — disable streaming
    if (fields.length === 1) return { kind: 'ol-once' };
    if (fields.length === 2) {
      if (fields[1] === '1') return { kind: 'ol-enable' };
      if (fields[1] === '0') return { kind: 'ol-disable' };
    }
    return { kind: 'ignore', reason: 'OL bad form' };
  }

  if (cmd === 'OS') {
    // #OS,1 — start streaming, #OS,0 — stop
    if (fields.length === 2) {
      if (fields[1] === '1') return { kind: 'os-start' };
      if (fields[1] === '0') return { kind: 'os-stop' };
    }
    return { kind: 'ignore', reason: 'OS bad form' };
  }

  return { kind: 'ignore', reason: `unknown command ${cmd}` };
}

/** Zero-pad an integer to 3 chars (`1` → `"001"`). */
function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

/**
 * Format an outgoing `V<NNN>,<MMM>,<FFF>,<value>*XX\r\n` line.
 *
 *  - `node`: FastNet node number (we always emit 1).
 *  - `msgType`: message type (we always emit 1 = Function Data).
 *  - `fn`: function number.
 *  - `value`: pre-formatted payload (`"4.37"`) or `""` for unmapped.
 */
export function formatV(
  fn: number,
  value: string,
  node: number = 1,
  msgType: number = 1,
): string {
  const payload = `V${pad3(node)},${pad3(msgType)},${pad3(fn)},${value}`;
  return `${payload}*${hlinkChecksum(payload)}\r\n`;
}

/**
 * Format an outgoing position line `P001,<lat>,<lon>*XX\r\n`. Decimal
 * degrees with 6 dp (≈ 0.1 m). This format is our extension; H-LINK doesn't
 * specify a position-reply shape.
 */
export function formatP(lat: number, lon: number, node: number = 1): string {
  const payload = `P${pad3(node)},${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `${payload}*${hlinkChecksum(payload)}\r\n`;
}
