# H6000 Phase 0a — NMEA 0183, B&G Motion PGNs, Session Persistence, Replay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 0a foundation so the box can ingest the rest of the boat's broadcast traffic — NMEA 0183 from legacy instruments, attitude/rate-of-turn from the B&G Precision-9 and H5000 motion sensor over N2K — and so every input session is durably logged and exactly replayable offline. After this plan, calibration tuning and compute pipelines can be developed against captured boat data without going sailing.

**Architecture:** The Phase 0a `WireDriver` interface grows two more observable streams (`rx0183` for NMEA 0183 sentences, `health` already exists). Existing `Ngt1Driver` returns `EMPTY` for the new streams; a new `SerialPort0183Driver` returns `EMPTY` for `rxCan`. The bridge orchestrator merges all streams from all drivers, each through its own decoder/mapper. A session-log writer subscribes to driver outputs (raw frames/sentences, not Samples — preserves replay fidelity) and writes timestamped JSONL to a gzipped file per session. A new `ReplayDriver` reads those files back as a normal `WireDriver`, indistinguishable from live hardware to the layers above.

**Tech Stack:**

- Adds: zero new runtime deps. NMEA 0183 parsing is implemented from scratch (sentences are simple). Gzip via Node's built-in `zlib`. File I/O via `node:fs/promises`.
- Existing: TypeScript, RxJS, vitest, canboatjs, serialport.

**Reference spec:** `docs/superpowers/specs/2026-05-08-h6000-design.md`. Implements build-sequence steps 6 (0183 input + decoder), 8 (persistence), 9 (replay), plus motion PGN extensions to step 4. Step 7 (IMU driver) is dropped — the boat has dedicated B&G sensors emitting these channels via N2K.

---

## What's in scope (and what's not)

**In scope:**

- NMEA 0183 input driver: opens an RS-422 USB dongle, reads `$XXSSS,...*HH\n` framed sentences.
- 0183 sentence parser: at minimum MWV (wind apparent/true), VHW (boat speed + heading), HDG (heading), VTG (course/speed over ground), GLL (position), DBT (depth). One-pass parse-and-validate-checksum.
- 0183 channel mapper: same shape as N2K mapper, different inputs.
- N2K mapper extension: PGN 127251 (rate of turn) and PGN 127257 (attitude — heel/pitch/yaw from H5000 motion sensor and Precision-9).
- Session logger: writes one `.jsonl.gz` per session to `sessions/`. Each line is a typed JSON record of one frame/sentence with `t_ns`, `source`, and the raw payload.
- Replay driver: reads a session log file and re-emits the recorded frames/sentences. Two modes: real-time (paced to original `t_ns` deltas) and as-fast-as-possible.
- A small CLI (`apps/autopilot-server`'s `--replay <path>`) that boots the server with a `ReplayDriver` instead of live hardware.

**Out of scope (keep deferring):**

- TX path on either bus (no calibrated true wind back to N2K yet — that's a later plan).
- Compute pipelines (true wind, polars, leeway, laylines).
- Persistence beyond raw inbound frames (no `config.db`, no SQLite — those land with the calibration UI).
- Auth, multi-session concurrency, log rotation by size — Phase 0a is "log a session, replay it".
- Any 0183 TX. Read-only this plan.

---

## File structure

```
autopilot/
├── packages/
│   ├── core/
│   │   └── src/
│   │       └── channels.ts                        MODIFY: add Motion.RateOfTurn, Motion.AttitudeYaw
│   ├── bridge/
│   │   └── src/
│   │       ├── wire-driver.ts                     MODIFY: add rx0183, Raw0183Sentence
│   │       ├── ngt-driver.ts                      MODIFY: add rx0183 = EMPTY
│   │       ├── nmea0183/
│   │       │   ├── sentence-parser.ts             NEW: parse one ASCII line → typed sentence
│   │       │   ├── sentence-parser.test.ts        NEW
│   │       │   ├── serial-driver.ts               NEW: SerialPort0183Driver (WireDriver)
│   │       │   ├── serial-driver.test.ts          NEW
│   │       │   ├── channel-mapper.ts              NEW: map sentences to Samples
│   │       │   └── channel-mapper.test.ts         NEW
│   │       ├── channel-mapper.ts                  MODIFY: add 127251, 127257
│   │       ├── channel-mapper.test.ts             MODIFY: add tests for the two new PGNs
│   │       ├── bridge.ts                          MODIFY: subscribe to rx0183 too
│   │       ├── bridge.test.ts                     MODIFY: add a 0183 end-to-end test
│   │       ├── persistence/
│   │       │   ├── session-logger.ts              NEW: gzipped JSONL writer
│   │       │   ├── session-logger.test.ts         NEW
│   │       │   ├── replay-driver.ts               NEW: ReplayDriver (WireDriver)
│   │       │   └── replay-driver.test.ts          NEW
│   │       └── index.ts                           MODIFY: export new public surface
│   └── (web unchanged — /inspect already shows whatever channels exist)
└── apps/
    └── autopilot-server/
        └── src/
            └── index.ts                           MODIFY: add 0183 driver, replay flag, session logging
```

---

## Task 1: Extend WireDriver interface for NMEA 0183

**Files:**

- Modify: `packages/bridge/src/wire-driver.ts`
- Modify: `packages/bridge/src/ngt-driver.ts`
- Modify: `packages/bridge/src/ngt-driver.test.ts` (no behavior change; sanity-check the new field types)

- [ ] **Step 1: Update `wire-driver.ts`**

```ts
import type { Observable } from 'rxjs';

export interface RawCanFrame {
  id: number;
  ext: true;
  data: Uint8Array;
  rxTimestamp: bigint;
}

/**
 * One NMEA 0183 sentence as received on the wire, before parsing.
 * `text` is the raw ASCII line minus its trailing CR/LF; `port` identifies
 * which physical RS-422 port produced it (so multi-port drivers can
 * disambiguate sources).
 */
export interface Raw0183Sentence {
  text: string;
  port: number;
  rxTimestamp: bigint;
}

export interface DriverHealth {
  connected: boolean;
  bytesPerSecond: number;
  framesPerSecond: number;
  errorCount: number;
}

/**
 * Phase-stable driver contract. Phase 0 implementations: Ngt1Driver,
 * SerialPort0183Driver, ReplayDriver. Phase 1: a single McuDriver.
 *
 * Drivers expose every input stream they care about. Drivers that don't
 * produce a given stream type return rxjs `EMPTY`. The bridge orchestrator
 * merges streams across drivers without special-casing source types.
 */
export interface WireDriver {
  rxCan: Observable<RawCanFrame>;
  rx0183: Observable<Raw0183Sentence>;
  txCan(frame: RawCanFrame): Promise<void>;
  tx0183(port: number, text: string): Promise<void>;
  health: Observable<DriverHealth>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 2: Update `ngt-driver.ts` to satisfy the new interface**

Add an `rx0183` field initialized to `EMPTY`, and a stub `tx0183` that throws (same pattern as the existing `txCan` stub):

```ts
import { Subject, type Observable, BehaviorSubject, EMPTY } from 'rxjs';
// ... rest of imports unchanged
```

Inside the `Ngt1Driver` class body, add:

```ts
  readonly rx0183: Observable<Raw0183Sentence> = EMPTY;
```

(import `Raw0183Sentence` from `./wire-driver.js`).

Add the method below the existing `txCan`:

```ts
  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('Ngt1Driver.tx0183 not implemented (NGT-1 has no 0183)');
  }
```

- [ ] **Step 3: Run all bridge tests**

```
npx vitest run packages/bridge
```

All 17 prior tests must still pass — this is a pure interface widening with no behavior change. If the typechecker complains in `bridge.ts` about the new methods, that's expected; we fix it in Task 5.

**Note:** `bridge.ts` will not fully typecheck after this step in isolation, because the bridge orchestrator type-checks against `WireDriver` and now sees new mandatory fields. We _will_ fix it in Task 5; for this task the failing typecheck is on `bridge.ts`, not the test you're running. Confirm tests pass and proceed.

If the test runner fails for type reasons in unrelated files, see Task 5 for the orchestrator update — you can do that update inline here if it bothers you, but the cleanest split keeps Task 5 focused.

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/wire-driver.ts packages/bridge/src/ngt-driver.ts
git commit -m "feat(bridge): widen WireDriver to expose rx0183 and tx0183"
```

---

## Task 2: NMEA 0183 sentence parser (TDD)

**Files:**

- Create: `packages/bridge/src/nmea0183/sentence-parser.ts`
- Test: `packages/bridge/src/nmea0183/sentence-parser.test.ts`

NMEA 0183 sentences look like `$XXSSS,field,field,field*HH` where `XX` is the talker (e.g. `WI`, `II`, `GP`), `SSS` is the sentence type, fields are comma-separated, and `HH` is a hex XOR checksum of every byte between `$` and `*` exclusive. We parse the structure once, validate the checksum, and emit a typed object.

- [ ] **Step 1: Write the failing tests**

`packages/bridge/src/nmea0183/sentence-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSentence, type ParsedSentence } from './sentence-parser.js';

const ok = (s: string): ParsedSentence => {
  const r = parseSentence(s);
  if (!r.ok) throw new Error(`expected ok parse, got ${r.error}`);
  return r.sentence;
};

describe('parseSentence — framing', () => {
  it('returns error on missing $', () => {
    const r = parseSentence('GPRMC,...,*1A');
    expect(r.ok).toBe(false);
  });

  it('returns error on missing checksum', () => {
    const r = parseSentence('$WIMWV,212.6,R,5.8,N,A');
    expect(r.ok).toBe(false);
  });

  it('returns error on bad checksum', () => {
    const r = parseSentence('$WIMWV,212.6,R,5.8,N,A*00');
    expect(r.ok).toBe(false);
  });

  it('parses a valid framing into talker, type, and fields', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*54');
    expect(s.talker).toBe('WI');
    expect(s.type).toBe('MWV');
    expect(s.fields).toEqual(['212.6', 'R', '5.8', 'N', 'A']);
  });
});

describe('parseSentence — MWV (wind)', () => {
  it('extracts apparent wind angle and speed', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*54');
    expect(s.type).toBe('MWV');
    // Higher-level interpretation lives in the channel mapper, not the parser.
    // The parser hands back the raw fields; assertions are on shape only.
    expect(s.fields[0]).toBe('212.6');
    expect(s.fields[1]).toBe('R');
    expect(s.fields[4]).toBe('A');
  });
});

describe('parseSentence — VHW (water speed and heading)', () => {
  it('parses fields', () => {
    const s = ok('$VWVHW,,T,,M,5.2,N,9.6,K*4F');
    expect(s.type).toBe('VHW');
    expect(s.fields[4]).toBe('5.2');
    expect(s.fields[5]).toBe('N');
  });
});

describe('parseSentence — HDG (heading)', () => {
  it('parses heading and deviation', () => {
    const s = ok('$HCHDG,98.3,1.2,W,5.6,E*32');
    expect(s.type).toBe('HDG');
    expect(s.fields[0]).toBe('98.3');
    expect(s.fields[2]).toBe('W');
  });
});

describe('parseSentence — VTG (course over ground)', () => {
  it('parses course and speed', () => {
    const s = ok('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48');
    expect(s.type).toBe('VTG');
    expect(s.fields[0]).toBe('054.7');
    expect(s.fields[4]).toBe('005.5');
  });
});

describe('parseSentence — strips trailing CR/LF', () => {
  it('handles \\r\\n termination', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*54\r\n');
    expect(s.type).toBe('MWV');
  });
});

describe('parseSentence — calculates checksum correctly', () => {
  // Independent verification: XOR of bytes between $ and *
  it('accepts known-good checksums', () => {
    expect(parseSentence('$WIMWV,212.6,R,5.8,N,A*54').ok).toBe(true);
    expect(parseSentence('$VWVHW,,T,,M,5.2,N,9.6,K*4F').ok).toBe(true);
    expect(parseSentence('$HCHDG,98.3,1.2,W,5.6,E*32').ok).toBe(true);
    expect(parseSentence('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```
npx vitest run packages/bridge/src/nmea0183/sentence-parser.test.ts
```

Expected: all fail with `Cannot find module './sentence-parser.js'`.

- [ ] **Step 3: Implement `sentence-parser.ts`**

```ts
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

export type ParseResult = { ok: true; sentence: ParsedSentence } | { ok: false; error: string };

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
```

- [ ] **Step 4: Run tests — expect pass**

```
npx vitest run packages/bridge/src/nmea0183/sentence-parser.test.ts
```

All 8+ tests pass. Typecheck `tsc -b packages/bridge` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/nmea0183/sentence-parser.ts packages/bridge/src/nmea0183/sentence-parser.test.ts
git commit -m "feat(bridge/0183): add sentence parser with checksum validation"
```

---

## Task 3: SerialPort0183Driver (TDD)

**Files:**

- Create: `packages/bridge/src/nmea0183/serial-driver.ts`
- Test: `packages/bridge/src/nmea0183/serial-driver.test.ts`

A `WireDriver` that opens (or accepts an injected) line-emitting source, batches bytes into `\n`-terminated lines, and emits each as a `Raw0183Sentence` on `rx0183`. Same `MemorySource` test pattern as `Ngt1Driver`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { SerialPort0183Driver, type Sentence0183Source } from './serial-driver.js';

class MemorySource implements Sentence0183Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void): this {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off(): this {
    this.listener = null;
    return this;
  }
  emit(text: string): void {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('SerialPort0183Driver', () => {
  let source: MemorySource;
  let driver: SerialPort0183Driver;

  beforeEach(async () => {
    source = new MemorySource();
    driver = new SerialPort0183Driver({ source, port: 1 });
    await driver.start();
  });

  it('emits one Raw0183Sentence per line received', async () => {
    const promised = firstValueFrom(driver.rx0183);
    source.emit('$WIMWV,212.6,R,5.8,N,A*54\r\n');
    const sentence = await promised;
    expect(sentence.text).toBe('$WIMWV,212.6,R,5.8,N,A*54');
    expect(sentence.port).toBe(1);
    expect(sentence.rxTimestamp).toBeTypeOf('bigint');
  });

  it('strips trailing CR but keeps the line otherwise verbatim', async () => {
    const promised = firstValueFrom(driver.rx0183);
    source.emit('$HCHDG,98.3,1.2,W,5.6,E*32\n');
    const sentence = await promised;
    expect(sentence.text).toBe('$HCHDG,98.3,1.2,W,5.6,E*32');
  });

  it('handles split chunks across the newline boundary', async () => {
    const collected = firstValueFrom(driver.rx0183.pipe(take(2), toArray()));
    source.emit('$WIMWV,212.6,R,5');
    source.emit('.8,N,A*54\n$HCHDG,98.3,1.2,W,5.6,E*32\n');
    const out = await collected;
    expect(out.map((s) => s.text)).toEqual([
      '$WIMWV,212.6,R,5.8,N,A*54',
      '$HCHDG,98.3,1.2,W,5.6,E*32',
    ]);
  });

  it('exposes EMPTY rxCan and throwing txCan', async () => {
    const seen: unknown[] = [];
    const sub = driver.rxCan.subscribe((f) => seen.push(f));
    source.emit('$WIMWV,212.6,R,5.8,N,A*54\n');
    await new Promise((r) => setTimeout(r, 5));
    sub.unsubscribe();
    expect(seen).toHaveLength(0);

    await expect(
      driver.txCan({
        id: 0,
        ext: true,
        data: new Uint8Array(),
        rxTimestamp: 0n,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```
npx vitest run packages/bridge/src/nmea0183/serial-driver.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `serial-driver.ts`**

```ts
import { Subject, type Observable, BehaviorSubject, EMPTY } from 'rxjs';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from '../wire-driver.js';

/**
 * The minimal shape of a serial source: any object that emits `Buffer`
 * chunks via 'data' events. The Node.js SerialPort matches; tests pass a
 * MemorySource.
 */
export interface Sentence0183Source {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  off(event: 'data', cb: (chunk: Buffer) => void): this;
}

export interface SerialPort0183DriverOptions {
  source: Sentence0183Source;
  /** Logical port number — used to disambiguate when a process owns >1. */
  port: number;
}

export class SerialPort0183Driver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame> = EMPTY;
  readonly rx0183: Observable<Raw0183Sentence>;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<Raw0183Sentence>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  private readonly source: Sentence0183Source;
  private readonly port: number;
  private buffer = '';
  private dataHandler = this.onData.bind(this);

  constructor(opts: SerialPort0183DriverOptions) {
    this.source = opts.source;
    this.port = opts.port;
    this.rx0183 = this.rxSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.source.on('data', this.dataHandler);
    this.healthSubject.next({
      ...this.healthSubject.value,
      connected: true,
    });
  }

  async stop(): Promise<void> {
    this.source.off('data', this.dataHandler);
    this.healthSubject.next({
      ...this.healthSubject.value,
      connected: false,
    });
  }

  async txCan(_frame: RawCanFrame): Promise<void> {
    throw new Error('SerialPort0183Driver.txCan not implemented (0183 driver carries no CAN)');
  }

  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('SerialPort0183Driver.tx0183 not implemented in Phase 0a');
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const text = raw.replace(/\r$/, '');
      if (text.length === 0) continue;
      this.rxSubject.next({
        text,
        port: this.port,
        rxTimestamp: BigInt(Date.now()) * 1_000_000n,
      });
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/bridge/src/nmea0183/serial-driver.test.ts
```

All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/nmea0183/serial-driver.ts packages/bridge/src/nmea0183/serial-driver.test.ts
git commit -m "feat(bridge/0183): add SerialPort0183Driver with line framing"
```

---

## Task 4: NMEA 0183 channel mapper (TDD)

**Files:**

- Create: `packages/bridge/src/nmea0183/channel-mapper.ts`
- Test: `packages/bridge/src/nmea0183/channel-mapper.test.ts`

Maps `Raw0183Sentence` → typed `Sample[]` after running through `parseSentence`. Phase 0a starts with MWV (wind), VHW (boat speed + heading), HDG (heading), VTG (course/speed over ground), GLL (position), DBT (depth). Adding more is one entry per type.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { Channels } from '@h6000/core';
import { mapSentenceToSamples } from './channel-mapper.js';
import type { Raw0183Sentence } from '../wire-driver.js';

const at = (text: string): Raw0183Sentence => ({
  text,
  port: 0,
  rxTimestamp: 1_700_000_000_000_000_000n,
});

describe('mapSentenceToSamples — MWV', () => {
  it('apparent wind to wind.apparent.angle and speed in m/s', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,R,5.8,N,A*54'));
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.ApparentAngle);
    expect(channels).toContain(Channels.Wind.ApparentSpeed);
    const speed = samples.find((s) => s.channel === Channels.Wind.ApparentSpeed)?.value;
    // 5.8 knots → 2.984 m/s, with rounding.
    expect(speed).toEqual({
      kind: 'scalar',
      value: 5.8 * 0.514444,
      unit: 'm/s',
    });
  });

  it('true wind reference goes to true.angle/speed', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,T,5.8,N,A*42'));
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.TrueAngle);
    expect(channels).toContain(Channels.Wind.TrueSpeed);
  });

  it('drops samples when status flag is V (invalid)', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,R,5.8,N,V*43'));
    expect(samples).toEqual([]);
  });
});

describe('mapSentenceToSamples — VHW', () => {
  it('extracts boat speed in m/s', () => {
    const samples = mapSentenceToSamples(at('$VWVHW,,T,,M,5.2,N,9.6,K*4F'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Boat.SpeedWater);
    const v = samples.find((s) => s.channel === Channels.Boat.SpeedWater)?.value;
    expect(v).toEqual({
      kind: 'scalar',
      value: 5.2 * 0.514444,
      unit: 'm/s',
    });
  });
});

describe('mapSentenceToSamples — HDG', () => {
  it('extracts magnetic heading in radians', () => {
    const samples = mapSentenceToSamples(at('$HCHDG,98.3,1.2,W,5.6,E*32'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Boat.HeadingMagnetic);
    const v = samples.find((s) => s.channel === Channels.Boat.HeadingMagnetic)?.value;
    expect(v).toEqual({
      kind: 'scalar',
      value: (98.3 * Math.PI) / 180,
      unit: 'rad',
    });
  });
});

describe('mapSentenceToSamples — VTG', () => {
  it('extracts cog (true) and sog', () => {
    const samples = mapSentenceToSamples(at('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Nav.Cog);
    expect(ch).toContain(Channels.Nav.Sog);
  });
});

describe('mapSentenceToSamples — unknown sentence types', () => {
  it('returns [] for an unmapped type', () => {
    const samples = mapSentenceToSamples(at('$GPGGA,,,,,,0,,,,,,,,*66'));
    expect(samples).toEqual([]);
  });

  it('returns [] when the sentence fails to parse', () => {
    const samples = mapSentenceToSamples(at('not a sentence'));
    expect(samples).toEqual([]);
  });
});

describe('mapSentenceToSamples — source tagging', () => {
  it('tags samples with port-aware source', () => {
    const samples = mapSentenceToSamples({
      text: '$WIMWV,212.6,R,5.8,N,A*54',
      port: 2,
      rxTimestamp: 1_700_000_000_000_000_000n,
    });
    expect(samples[0]?.source).toBe('0183:port2:WIMWV');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement `channel-mapper.ts`**

```ts
import { Channels, type Sample, type ChannelValue } from '@h6000/core';
import { parseSentence, type ParsedSentence } from './sentence-parser.js';
import type { Raw0183Sentence } from '../wire-driver.js';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

const scalar = (value: number, unit?: string): ChannelValue => ({
  kind: 'scalar',
  value,
  unit,
});

const sourceTag = (raw: Raw0183Sentence, addr: string): string => `0183:port${raw.port}:${addr}`;

type Mapper = (parsed: ParsedSentence, raw: Raw0183Sentence) => Sample[];

const mappers: Record<string, Mapper> = {
  // MWV: Wind angle and speed (apparent or true).
  // Fields: [ angle_deg, R|T, speed, K|M|N, status_A|V ]
  MWV: (s, raw) => {
    const status = s.fields[4] ?? '';
    if (status !== 'A') return [];
    const angleDeg = Number(s.fields[0]);
    const ref = s.fields[1] ?? '';
    const speedRaw = Number(s.fields[2]);
    const unit = s.fields[3] ?? '';
    if (!Number.isFinite(angleDeg) || !Number.isFinite(speedRaw)) return [];
    const speed = unit === 'N' ? speedRaw * KNOTS_TO_MS : unit === 'K' ? speedRaw / 3.6 : speedRaw;
    const isApparent = ref === 'R';
    const out: Sample[] = [];
    out.push({
      channel: isApparent ? Channels.Wind.ApparentAngle : Channels.Wind.TrueAngle,
      t_ns: raw.rxTimestamp,
      value: scalar(angleDeg * DEG_TO_RAD, 'rad'),
      source: sourceTag(raw, `${s.talker}${s.type}`),
    });
    out.push({
      channel: isApparent ? Channels.Wind.ApparentSpeed : Channels.Wind.TrueSpeed,
      t_ns: raw.rxTimestamp,
      value: scalar(speed, 'm/s'),
      source: sourceTag(raw, `${s.talker}${s.type}`),
    });
    return out;
  },

  // VHW: Water speed and heading.
  // Fields: [ heading_T, T, heading_M, M, speed_kn, N, speed_km, K ]
  VHW: (s, raw) => {
    const speedKn = Number(s.fields[4]);
    if (!Number.isFinite(speedKn)) return [];
    return [
      {
        channel: Channels.Boat.SpeedWater,
        t_ns: raw.rxTimestamp,
        value: scalar(speedKn * KNOTS_TO_MS, 'm/s'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      },
    ];
  },

  // HDG: Heading, deviation and variation.
  // Fields: [ heading_deg, deviation, dev_dir(E|W), variation, var_dir(E|W) ]
  HDG: (s, raw) => {
    const headingDeg = Number(s.fields[0]);
    if (!Number.isFinite(headingDeg)) return [];
    return [
      {
        channel: Channels.Boat.HeadingMagnetic,
        t_ns: raw.rxTimestamp,
        value: scalar(headingDeg * DEG_TO_RAD, 'rad'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      },
    ];
  },

  // VTG: Course and speed over ground.
  // Fields: [ cog_T, T, cog_M, M, sog_kn, N, sog_km, K ]
  VTG: (s, raw) => {
    const cogTrueDeg = Number(s.fields[0]);
    const sogKn = Number(s.fields[4]);
    const out: Sample[] = [];
    if (Number.isFinite(cogTrueDeg)) {
      out.push({
        channel: Channels.Nav.Cog,
        t_ns: raw.rxTimestamp,
        value: scalar(cogTrueDeg * DEG_TO_RAD, 'rad'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      });
    }
    if (Number.isFinite(sogKn)) {
      out.push({
        channel: Channels.Nav.Sog,
        t_ns: raw.rxTimestamp,
        value: scalar(sogKn * KNOTS_TO_MS, 'm/s'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      });
    }
    return out;
  },
};

export function mapSentenceToSamples(raw: Raw0183Sentence): Sample[] {
  const parsed = parseSentence(raw.text);
  if (!parsed.ok) return [];
  const fn = mappers[parsed.sentence.type];
  return fn ? fn(parsed.sentence, raw) : [];
}
```

- [ ] **Step 4: Run — expect pass**

All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/nmea0183/channel-mapper.ts packages/bridge/src/nmea0183/channel-mapper.test.ts
git commit -m "feat(bridge/0183): map MWV, VHW, HDG, VTG sentences to channels"
```

---

## Task 5: Bridge orchestrator subscribes to rx0183

**Files:**

- Modify: `packages/bridge/src/bridge.ts`
- Modify: `packages/bridge/src/bridge.test.ts`
- Modify: `packages/bridge/src/index.ts`

The orchestrator currently merges only `rxCan`. Add a parallel pipeline that takes each driver's `rx0183`, runs through `mapSentenceToSamples`, and publishes Samples on the same Bus.

- [ ] **Step 1: Update `bridge.ts`**

```ts
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
```

- [ ] **Step 2: Add a 0183 end-to-end test to `bridge.test.ts`**

Append (do not replace) to the existing `describe('runBridge', ...)`:

```ts
import { SerialPort0183Driver, type Sentence0183Source } from './nmea0183/serial-driver.js';
// (Or wherever the existing imports go.)

class Memory0183Source implements Sentence0183Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void) {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off() {
    this.listener = null;
    return this;
  }
  emit(text: string) {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('runBridge — 0183 path', () => {
  it('publishes wind samples to the bus when an MWV sentence arrives', async () => {
    const bus = new Bus();
    const source = new Memory0183Source();
    const driver = new SerialPort0183Driver({ source, port: 0 });
    const stop = await runBridge({ bus, drivers: [driver] });

    const received: Sample[] = [];
    bus.subscribe('wind.**', (s) => received.push(s));

    source.emit('$WIMWV,212.6,R,5.8,N,A*54\r\n');
    await new Promise((r) => setTimeout(r, 10));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has(Channels.Wind.ApparentAngle)).toBe(true);
    expect(channels.has(Channels.Wind.ApparentSpeed)).toBe(true);

    await stop();
  });
});
```

- [ ] **Step 3: Update `packages/bridge/src/index.ts`**

Add the new exports:

```ts
export * from './wire-driver.js';
export * from './ngt-driver.js';
export * from './decoder.js';
export * from './channel-mapper.js';
export * from './bridge.js';
export * from './nmea0183/sentence-parser.js';
export * from './nmea0183/serial-driver.js';
export * from './nmea0183/channel-mapper.js';
```

- [ ] **Step 4: Run all bridge tests — expect pass**

```
npx vitest run packages/bridge
```

All prior tests + the new 0183 end-to-end pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/bridge.ts packages/bridge/src/bridge.test.ts packages/bridge/src/index.ts
git commit -m "feat(bridge): orchestrator subscribes to rx0183 from all drivers"
```

---

## Task 6: Extend N2K mapper for motion PGNs (127251 rate-of-turn, 127257 attitude)

**Files:**

- Modify: `packages/core/src/channels.ts`
- Modify: `packages/bridge/src/channel-mapper.ts`
- Modify: `packages/bridge/src/channel-mapper.test.ts`

The B&G Precision-9 emits PGN 127251 (rate of turn) and PGN 127257 (attitude). The H5000 3D Motion Sensor emits PGN 127257 too. Field names from canboatjs:

- **PGN 127251** — `Rate of Turn` (rad/s, signed; positive = clockwise from above).
- **PGN 127257** — `Yaw`, `Pitch`, `Roll` (radians), all signed.

We've already declared `Channels.Motion.{Heel, Pitch, Yaw}`. Add `Channels.Motion.RateOfTurn` for completeness, then add two new mappers.

- [ ] **Step 1: Update `packages/core/src/channels.ts`**

In the `Motion` block, append `RateOfTurn`:

```ts
  Motion: {
    Heel: 'motion.heel',
    Pitch: 'motion.pitch',
    Yaw: 'motion.yaw',
    RateOfTurn: 'motion.rateOfTurn',
  },
```

(Heel uses the spec's name; the underlying signal is "Roll" in canboat parlance. Heel = roll for sailing; we keep the sailing-domain name.)

- [ ] **Step 2: Rebuild core**

Because Next.js consumes core via `dist/`, it must be rebuilt:

```
npm run build --workspace=@h6000/core
```

- [ ] **Step 3: Add tests for the two new PGN mappers**

In `packages/bridge/src/channel-mapper.test.ts`, append:

```ts
it('maps PGN 127251 rate-of-turn to motion.rateOfTurn', () => {
  const decoded = make(127251, { 'Rate of Turn': 0.0123 });
  const samples = mapPgnToSamples(decoded);
  expect(samples.map((s) => s.channel)).toEqual([Channels.Motion.RateOfTurn]);
  expect(samples[0]?.value).toEqual({
    kind: 'scalar',
    value: 0.0123,
    unit: 'rad/s',
  });
});

it('maps PGN 127257 attitude to heel, pitch, yaw', () => {
  const decoded = make(127257, {
    Yaw: 1.23,
    Pitch: -0.05,
    Roll: 0.18,
  });
  const samples = mapPgnToSamples(decoded);
  const channels = samples.map((s) => s.channel).sort();
  expect(channels).toEqual(
    [Channels.Motion.Heel, Channels.Motion.Pitch, Channels.Motion.Yaw].sort(),
  );
  const heel = samples.find((s) => s.channel === Channels.Motion.Heel);
  expect(heel?.value).toEqual({ kind: 'scalar', value: 0.18, unit: 'rad' });
});
```

- [ ] **Step 4: Run tests — expect failure**

The new tests fail because the mappers don't exist yet.

- [ ] **Step 5: Add the two new mappers in `packages/bridge/src/channel-mapper.ts`**

Inside the existing `mappers: Record<number, MapperFn>` object, after the existing entries, add:

```ts
  // PGN 127251 — rate of turn (rad/s).
  127251: (pgn) => {
    const v = pgn.fields['Rate of Turn'];
    if (typeof v !== 'number') return [];
    return [
      {
        channel: Channels.Motion.RateOfTurn,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'rad/s'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127257 — attitude (yaw/pitch/roll, all in radians).
  // Sailing convention: roll = heel.
  127257: (pgn) => {
    const yaw = pgn.fields['Yaw'];
    const pitch = pgn.fields['Pitch'];
    const roll = pgn.fields['Roll'];
    const out: Sample[] = [];
    if (typeof yaw === 'number') {
      out.push({
        channel: Channels.Motion.Yaw,
        t_ns: pgn.rxTimestamp,
        value: scalar(yaw, 'rad'),
        source: sourceTag(pgn),
      });
    }
    if (typeof pitch === 'number') {
      out.push({
        channel: Channels.Motion.Pitch,
        t_ns: pgn.rxTimestamp,
        value: scalar(pitch, 'rad'),
        source: sourceTag(pgn),
      });
    }
    if (typeof roll === 'number') {
      out.push({
        channel: Channels.Motion.Heel,
        t_ns: pgn.rxTimestamp,
        value: scalar(roll, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },
```

- [ ] **Step 6: Run all tests — expect pass**

```
npx vitest run packages/bridge
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/channels.ts packages/bridge/src/channel-mapper.ts packages/bridge/src/channel-mapper.test.ts
git commit -m "feat: map PGN 127251 (rate of turn) and 127257 (attitude) to motion channels"
```

---

## Task 7: Session logger (TDD)

**Files:**

- Create: `packages/bridge/src/persistence/session-logger.ts`
- Test: `packages/bridge/src/persistence/session-logger.test.ts`

Subscribes to all WireDrivers' `rxCan` and `rx0183` streams and writes each event as a single JSON line to a gzip-compressed file. Output schema:

```json
{"t_ns":"1700000000000000000","kind":"can","src":"...","prio":2,"pgn":130306,"data":"a01602fe7fff fafa"}
{"t_ns":"1700000000050000000","kind":"0183","port":1,"text":"$WIMWV,212.6,R,5.8,N,A*54"}
```

`t_ns` is a string (BigInt, beyond `Number.MAX_SAFE_INTEGER` for ns since epoch). The replay driver decodes it with `BigInt(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Subject } from 'rxjs';
import { startSessionLogger, type SessionLogger } from './session-logger.js';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from '../wire-driver.js';
import { EMPTY, of, BehaviorSubject } from 'rxjs';

class FakeDriver implements WireDriver {
  rxCan = new Subject<RawCanFrame>();
  rx0183 = new Subject<Raw0183Sentence>();
  health = new BehaviorSubject<DriverHealth>({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  start = async () => {};
  stop = async () => {};
  txCan = async () => {
    throw new Error('not impl');
  };
  tx0183 = async () => {
    throw new Error('not impl');
  };
}

describe('startSessionLogger', () => {
  let dir: string;
  let logger: SessionLogger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-log-'));
  });

  afterEach(async () => {
    await logger?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a header line + one event per CAN frame to a .jsonl.gz file', async () => {
    const driver = new FakeDriver();
    logger = await startSessionLogger({
      drivers: [driver],
      dir,
      sessionId: 'abc',
    });

    driver.rxCan.next({
      id: 0x09fd0211,
      ext: true,
      data: new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
      rxTimestamp: 1_700_000_000_000_000_000n,
    });
    driver.rx0183.next({
      text: '$WIMWV,212.6,R,5.8,N,A*54',
      port: 1,
      rxTimestamp: 1_700_000_000_050_000_000n,
    });

    await new Promise((r) => setTimeout(r, 20));
    await logger.close();

    const filePath = path.join(dir, 'abc.jsonl.gz');
    expect(existsSync(filePath)).toBe(true);
    const text = gunzipSync(readFileSync(filePath)).toString('utf8');
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Header line
    const header = JSON.parse(lines[0]!);
    expect(header.kind).toBe('header');
    expect(typeof header.startedAt).toBe('string');
    expect(header.sessionId).toBe('abc');
    expect(header.format).toBe('h6000-session-v1');

    // CAN line
    const canLine = JSON.parse(lines[1]!);
    expect(canLine.kind).toBe('can');
    expect(canLine.t_ns).toBe('1700000000000000000');
    expect(canLine.id).toBe(0x09fd0211);
    expect(canLine.data).toBe('a01602fe7fff fafa'.replace(/ /g, ''));

    // 0183 line
    const otLine = JSON.parse(lines[2]!);
    expect(otLine.kind).toBe('0183');
    expect(otLine.port).toBe(1);
    expect(otLine.text).toBe('$WIMWV,212.6,R,5.8,N,A*54');
  });

  it('flushes pending writes on close()', async () => {
    const driver = new FakeDriver();
    logger = await startSessionLogger({
      drivers: [driver],
      dir,
      sessionId: 'flush',
    });

    for (let i = 0; i < 50; i++) {
      driver.rx0183.next({
        text: `$XXMSG,${i}*00`,
        port: 0,
        rxTimestamp: BigInt(i) * 1_000_000n,
      });
    }
    await logger.close();

    const filePath = path.join(dir, 'flush.jsonl.gz');
    const lines = gunzipSync(readFileSync(filePath)).toString('utf8').trim().split('\n');
    // 1 header + 50 events
    expect(lines.length).toBe(51);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement `session-logger.ts`**

```ts
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createGzip, type Gzip } from 'node:zlib';
import { Subscription } from 'rxjs';
import type { WireDriver } from '../wire-driver.js';

export interface StartSessionLoggerOptions {
  drivers: WireDriver[];
  dir: string;
  sessionId: string;
}

export interface SessionLogger {
  /** Stop subscribing and flush pending writes to disk. Idempotent. */
  close(): Promise<void>;
}

/**
 * Subscribe to every driver's CAN and 0183 streams, serializing each event
 * as a single-line JSON record to `<dir>/<sessionId>.jsonl.gz`. The file
 * starts with a header line carrying schema metadata.
 *
 * BigInt timestamps are stringified — JSON.stringify cannot serialize bigint
 * directly; the replay reader rebuilds them via `BigInt(line.t_ns)`.
 */
export async function startSessionLogger(opts: StartSessionLoggerOptions): Promise<SessionLogger> {
  await mkdir(opts.dir, { recursive: true });
  const filePath = path.join(opts.dir, `${opts.sessionId}.jsonl.gz`);
  const fileStream = createWriteStream(filePath);
  const gzip = createGzip();
  gzip.pipe(fileStream);

  const subs: Subscription[] = [];
  let closed = false;

  const writeLine = (obj: unknown): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const line = JSON.stringify(obj) + '\n';
      gzip.write(line, 'utf8', (err) => (err ? reject(err) : resolve()));
    });

  // Header
  await writeLine({
    kind: 'header',
    format: 'h6000-session-v1',
    sessionId: opts.sessionId,
    startedAt: new Date().toISOString(),
  });

  for (const driver of opts.drivers) {
    subs.push(
      driver.rxCan.subscribe((frame) => {
        if (closed) return;
        const data = Array.from(frame.data, (b) => b.toString(16).padStart(2, '0')).join('');
        void writeLine({
          kind: 'can',
          t_ns: frame.rxTimestamp.toString(),
          id: frame.id,
          data,
        });
      }),
    );
    subs.push(
      driver.rx0183.subscribe((s) => {
        if (closed) return;
        void writeLine({
          kind: '0183',
          t_ns: s.rxTimestamp.toString(),
          port: s.port,
          text: s.text,
        });
      }),
    );
  }

  return {
    async close() {
      if (closed) return;
      closed = true;
      for (const s of subs) s.unsubscribe();
      await new Promise<void>((resolve, reject) => {
        gzip.end((err: NodeJS.ErrnoException | null | undefined) =>
          err ? reject(err) : resolve(),
        );
      });
      await new Promise<void>((resolve) => {
        if (fileStream.closed) resolve();
        else fileStream.once('close', () => resolve());
      });
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/bridge/src/persistence/session-logger.test.ts
```

Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/persistence/session-logger.ts packages/bridge/src/persistence/session-logger.test.ts
git commit -m "feat(bridge): session logger writing gzipped JSONL of all driver streams"
```

---

## Task 8: Replay driver (TDD)

**Files:**

- Create: `packages/bridge/src/persistence/replay-driver.ts`
- Test: `packages/bridge/src/persistence/replay-driver.test.ts`

A `WireDriver` that reads a `.jsonl.gz` session log and re-emits the recorded `RawCanFrame` and `Raw0183Sentence` events. Two modes: real-time (paced to original timestamps) and as-fast-as-possible.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom, take, toArray } from 'rxjs';
import { startSessionLogger } from './session-logger.js';
import { ReplayDriver } from './replay-driver.js';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from '../wire-driver.js';
import { Subject, BehaviorSubject } from 'rxjs';

class FakeDriver implements WireDriver {
  rxCan = new Subject<RawCanFrame>();
  rx0183 = new Subject<Raw0183Sentence>();
  health = new BehaviorSubject<DriverHealth>({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  start = async () => {};
  stop = async () => {};
  txCan = async () => {
    throw new Error();
  };
  tx0183 = async () => {
    throw new Error();
  };
}

describe('ReplayDriver', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-replay-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a recorded session through the replay driver', async () => {
    // Record a fake session.
    const fake = new FakeDriver();
    const logger = await startSessionLogger({
      drivers: [fake],
      dir,
      sessionId: 'rt',
    });
    const ts = (n: number) => BigInt(1_700_000_000_000n) * 1_000_000n + BigInt(n) * 1_000_000n;
    fake.rxCan.next({
      id: 0x09fd0211,
      ext: true,
      data: new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
      rxTimestamp: ts(0),
    });
    fake.rx0183.next({
      text: '$WIMWV,212.6,R,5.8,N,A*54',
      port: 1,
      rxTimestamp: ts(50),
    });
    await new Promise((r) => setTimeout(r, 10));
    await logger.close();

    // Replay it.
    const driver = new ReplayDriver({
      filePath: path.join(dir, 'rt.jsonl.gz'),
      mode: 'asap',
    });
    const canFrames: RawCanFrame[] = [];
    const sentences: Raw0183Sentence[] = [];
    const canSub = driver.rxCan.subscribe((f) => canFrames.push(f));
    const otSub = driver.rx0183.subscribe((s) => sentences.push(s));
    await driver.start();
    // Wait for the file to drain.
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        if (canFrames.length === 1 && sentences.length === 1) {
          clearInterval(id);
          resolve();
        }
      }, 5);
    });
    await driver.stop();
    canSub.unsubscribe();
    otSub.unsubscribe();

    expect(canFrames).toHaveLength(1);
    expect(canFrames[0]!.id).toBe(0x09fd0211);
    expect(canFrames[0]!.data).toEqual(
      new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
    );
    expect(canFrames[0]!.rxTimestamp).toBe(ts(0));

    expect(sentences).toHaveLength(1);
    expect(sentences[0]!.text).toBe('$WIMWV,212.6,R,5.8,N,A*54');
    expect(sentences[0]!.port).toBe(1);
    expect(sentences[0]!.rxTimestamp).toBe(ts(50));
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement `replay-driver.ts`**

```ts
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Subject, BehaviorSubject, EMPTY, type Observable } from 'rxjs';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from '../wire-driver.js';

export interface ReplayDriverOptions {
  filePath: string;
  /**
   * - `asap`: emit events as fast as the file can be read (no pacing).
   * - `realtime`: pace by original `t_ns` deltas; preserves recorded timing.
   */
  mode: 'asap' | 'realtime';
}

interface CanLine {
  kind: 'can';
  t_ns: string;
  id: number;
  data: string;
}

interface Ot0183Line {
  kind: '0183';
  t_ns: string;
  port: number;
  text: string;
}

interface HeaderLine {
  kind: 'header';
  format: string;
  sessionId: string;
  startedAt: string;
}

type LogLine = CanLine | Ot0183Line | HeaderLine;

export class ReplayDriver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly rx0183: Observable<Raw0183Sentence>;
  readonly health: Observable<DriverHealth>;

  private readonly canSubject = new Subject<RawCanFrame>();
  private readonly otSubject = new Subject<Raw0183Sentence>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });

  private aborted = false;

  constructor(private readonly opts: ReplayDriverOptions) {
    this.rxCan = this.canSubject.asObservable();
    this.rx0183 = this.otSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.healthSubject.next({ ...this.healthSubject.value, connected: true });
    void this.run();
  }

  async stop(): Promise<void> {
    this.aborted = true;
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
  }

  async txCan(): Promise<void> {
    throw new Error('ReplayDriver.txCan not supported');
  }

  async tx0183(): Promise<void> {
    throw new Error('ReplayDriver.tx0183 not supported');
  }

  private async run(): Promise<void> {
    const file = createReadStream(this.opts.filePath);
    const gunzip = createGunzip();
    const lines = createInterface({ input: file.pipe(gunzip) });

    let firstEventNs: bigint | null = null;
    const wallStart = Date.now();

    for await (const raw of lines) {
      if (this.aborted) break;
      if (raw.length === 0) continue;
      let parsed: LogLine;
      try {
        parsed = JSON.parse(raw) as LogLine;
      } catch {
        continue;
      }
      if (parsed.kind === 'header') continue;

      const tNs = BigInt(parsed.t_ns);
      if (this.opts.mode === 'realtime') {
        if (firstEventNs === null) firstEventNs = tNs;
        const elapsedRecMs = Number((tNs - firstEventNs) / 1_000_000n);
        const elapsedWallMs = Date.now() - wallStart;
        const delay = elapsedRecMs - elapsedWallMs;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }

      if (parsed.kind === 'can') {
        const data = hexToBytes(parsed.data);
        this.canSubject.next({
          id: parsed.id,
          ext: true,
          data,
          rxTimestamp: tNs,
        });
      } else if (parsed.kind === '0183') {
        this.otSubject.next({
          text: parsed.text,
          port: parsed.port,
          rxTimestamp: tNs,
        });
      }
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/persistence/replay-driver.ts packages/bridge/src/persistence/replay-driver.test.ts
git commit -m "feat(bridge): replay driver reads .jsonl.gz session logs"
```

---

## Task 9: Persistence + replay barrel exports

**Files:**

- Modify: `packages/bridge/src/index.ts`

Add to the existing barrel:

```ts
export * from './persistence/session-logger.js';
export * from './persistence/replay-driver.js';
```

- [ ] **Step 1: Update index.ts**

- [ ] **Step 2: Run typecheck**

```
npx tsc -b packages/bridge
```

Clean.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/index.ts
git commit -m "chore(bridge): export persistence and replay surface"
```

---

## Task 10: Wire 0183 driver, session logger, and replay flag into autopilot-server

**Files:**

- Modify: `apps/autopilot-server/src/index.ts`

Adds optional 0183 input via `NMEA0183_PATHS=/dev/ttyUSB1,/dev/ttyUSB2`, optional session logging via `SESSION_LOG_DIR=...`, and replay mode via `REPLAY=path/to/session.jsonl.gz`.

- [ ] **Step 1: Replace `apps/autopilot-server/src/index.ts`**

```ts
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@h6000/core';
import {
  Ngt1Driver,
  SerialPort0183Driver,
  ReplayDriver,
  runBridge,
  startSessionLogger,
  type WireDriver,
  type SessionLogger,
} from '@h6000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const DEV = process.env.NODE_ENV !== 'production';
const NMEA0183_PATHS = (process.env.NMEA0183_PATHS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const SESSION_LOG_DIR = process.env.SESSION_LOG_DIR ?? null;
const REPLAY = process.env.REPLAY ?? null;
const REPLAY_MODE: 'asap' | 'realtime' = process.env.REPLAY_MODE === 'asap' ? 'asap' : 'realtime';

async function main(): Promise<void> {
  const bus = getSharedBus();
  const drivers: WireDriver[] = [];
  const teardown: Array<() => Promise<void>> = [];

  // Replay mode short-circuits all live driver setup.
  if (REPLAY) {
    const driver = new ReplayDriver({ filePath: REPLAY, mode: REPLAY_MODE });
    drivers.push(driver);
    // eslint-disable-next-line no-console
    console.log(`[autopilot] replay mode (${REPLAY_MODE}): ${REPLAY}`);
  } else {
    const skipBridge = process.env.SKIP_BRIDGE === '1';

    if (!skipBridge) {
      try {
        const port = new SerialPort({
          path: SERIAL_PATH,
          baudRate: BAUD_RATE,
          autoOpen: false,
        });
        await new Promise<void>((resolve, reject) => {
          port.open((err) => (err ? reject(err) : resolve()));
        });
        drivers.push(new Ngt1Driver({ source: port }));
        // eslint-disable-next-line no-console
        console.log(`[autopilot] NGT-1 online via ${SERIAL_PATH}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[autopilot] NGT-1 offline (${err instanceof Error ? err.message : String(err)})`,
        );
      }

      for (const [i, p183] of NMEA0183_PATHS.entries()) {
        try {
          const port = new SerialPort({
            path: p183,
            baudRate: 4800,
            autoOpen: false,
          });
          await new Promise<void>((resolve, reject) => {
            port.open((err) => (err ? reject(err) : resolve()));
          });
          drivers.push(new SerialPort0183Driver({ source: port, port: i + 1 }));
          // eslint-disable-next-line no-console
          console.log(`[autopilot] 0183 port${i + 1} online via ${p183}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] 0183 port${i + 1} offline (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }
  }

  if (drivers.length > 0) {
    const stop = await runBridge({ bus, drivers });
    teardown.push(stop);
  }

  // Optional session logger — independent of which drivers are active. In
  // replay mode we skip logging (don't re-record the same data).
  let logger: SessionLogger | null = null;
  if (SESSION_LOG_DIR && !REPLAY) {
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    logger = await startSessionLogger({
      drivers,
      dir: SESSION_LOG_DIR,
      sessionId,
    });
    // eslint-disable-next-line no-console
    console.log(`[autopilot] session log: ${path.join(SESSION_LOG_DIR, sessionId + '.jsonl.gz')}`);
    teardown.push(() => logger!.close());
  }

  // Start Next.js pointing at the @h6000/web package directory.
  const webDir = path.resolve(fileURLToPath(import.meta.url), '../../../../packages/web');
  const app = next({ dev: DEV, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(HTTP_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[autopilot] web UI on http://0.0.0.0:${HTTP_PORT}`);
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    server.close();
    for (const t of teardown.reverse()) await t();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[autopilot] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test replay mode**

You'll need a session file. Easiest path:

1. Build the workspace: `npm run build --workspace=@h6000/core` (the bridge package consumes core via TS source so doesn't need building).
2. Run a tiny one-off script that records a synthetic 0183 sentence to a session file. (Skip this if you'd rather verify on real hardware later.)
3. Or, run a session that includes only the 0183 logger and replay it back through the same process.

For an automated check that the integration code at least compiles and boots:

```
SKIP_BRIDGE=1 timeout 10 npm run dev --workspace=@h6000/autopilot-server
```

Expect: server boots, logs no NGT-1 attempt and no 0183 attempt (because SKIP_BRIDGE=1 short-circuits both), `/inspect` returns the same empty page as before. This proves the new code paths don't regress the existing scenario.

- [ ] **Step 3: Typecheck**

```
npx tsc -b apps/autopilot-server
```

- [ ] **Step 4: Commit**

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(server): support 0183 drivers, session logging, and replay mode"
```

---

## Task 11: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```
npm test
```

Expected: all packages pass. Approximate count:

- `core/bus.test.ts`: 6
- `core/json-safe.test.ts`: 2
- `bridge/ngt-driver.test.ts`: 2
- `bridge/decoder.test.ts`: 2
- `bridge/channel-mapper.test.ts`: 8 (was 6, +2 for motion PGNs)
- `bridge/bridge.test.ts`: 2 (was 1, +1 for 0183 e2e)
- `bridge/nmea0183/sentence-parser.test.ts`: 8+
- `bridge/nmea0183/serial-driver.test.ts`: 4
- `bridge/nmea0183/channel-mapper.test.ts`: 7
- `bridge/persistence/session-logger.test.ts`: 2
- `bridge/persistence/replay-driver.test.ts`: 1

Roughly **44+ tests** passing.

- [ ] **Step 2: Typecheck workspace**

```
npx tsc -b
```

Clean exit.

- [ ] **Step 3: Run prettier**

```
npm run lint
```

If anything is unformatted, run `npm run format` and check the diff.

- [ ] **Step 4: Commit any prettier-formatted files**

```bash
git add -u
git commit -m "chore: prettier formatting after 0183/persistence/replay landing"
```

(Skip if there's nothing to add.)

---

## Closing notes

After this plan lands:

- The bridge ingests N2K + 0183 + can be replayed offline from disk.
- Motion data flows from your existing B&G hardware (Precision-9 + H5000 motion sensor) over the same N2K path.
- Every minute of sailing produces a `.jsonl.gz` you can re-feed through the entire stack at home — perfect-fidelity replay.

The next plan should pick up the **calibration + true-wind compute** path: SQLite + Drizzle for the boat-config DB, true-wind pipeline (cal table → vector subtraction → bus output), AWS/AWA cal table editor, tack-test wizard, polars editor (Expedition CSV import), and N2K transmit (so the calibrated true wind makes it back to the Zeus SR plotter).

Out of this plan we deliberately did NOT add:

- Compute pipelines or calibration tables (next plan)
- N2K TX (next plan)
- Authentication, log rotation, multi-session interleaving (later)
- IMU driver (skipped — N2K motion data covers it)
