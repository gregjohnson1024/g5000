# AP Test Controls Implementation Plan

> **Status:** Executed 2026-05-15. Implementation deviated from this plan in one substantive way: Task 1's helper was renamed `encodePgnToCanFrames` and switched from `pgnToActisenseSerialFormat` (which returns a single reassembled-payload line, not per-CAN-frame) to `pgnToYdgwRawFormat` (the correct per-frame encoder). All downstream tasks consume the new name. The spec at `docs/superpowers/specs/2026-05-15-ap-test-controls-design.md` reflects the final design; this plan is preserved as the historical execution record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Augment `/autopilot` with Mac-only TX buttons that send real PGN 130850 frames to the H5000 over the YDWG-02 RAW TCP gateway. Pi cannot accidentally transmit (three-layer env-var gate).

**Architecture:** Pure helper `parseActisenseFrameLines` splits canboatjs's multi-line Fast Packet output into ordered CAN frames; the YDWG driver's existing `txPgn` is rewritten to emit them in sequence via `txCan`. A new `AutopilotTx` singleton (mirroring `alerts.ts`) is registered by the bridge at boot only when `G5000_ENABLE_AP_TX=1`. The `/autopilot` page becomes a Server Component that conditionally renders a new client `ControlPanel` underneath the existing read-only readouts.

**Tech Stack:** TypeScript, Next.js App Router, RxJS, `@canboat/canboatjs`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-ap-test-controls-design.md`

---

## File structure

### Create
- `packages/bridge/src/tx/fast-packet.ts` — pure helper splitting canboatjs multi-line output into ordered `RawCanFrame[]`
- `packages/bridge/src/tx/fast-packet.test.ts` — round-trip + frame-counter + single-frame tests
- `packages/bridge/src/autopilot-commands.ts` — pure `resolveCommand(event, captureCodes)` returning a PGN field-bag
- `packages/bridge/src/autopilot-commands.test.ts`
- `packages/bridge/src/capture-codes.ts` — reads `~/.g5000-router/ap-tx-codes.json` (empty default)
- `packages/bridge/src/capture-codes.test.ts`
- `packages/bridge/src/autopilot-tx-impl.ts` — `createAutopilotTx(driver)` factory + `registerAutopilotTxIfEnabled(driver)`
- `packages/bridge/src/autopilot-tx-impl.test.ts`
- `packages/core/src/autopilot-tx.ts` — `AutopilotTx` interface + globalThis singleton getter/setter
- `packages/web/src/app/autopilot/control-panel.tsx` — client component with buttons, modal, log
- `packages/web/src/app/autopilot/readonly-view.tsx` — extracted client component holding today's readouts
- `packages/web/src/app/api/autopilot/command/route.ts`
- `packages/web/src/app/api/autopilot/capture-codes/route.ts`

### Modify
- `packages/bridge/src/ydwg-raw-tcp-driver.ts` — rewrite `txPgn` to use `parseActisenseFrameLines`
- `packages/bridge/src/ydwg-raw-tcp-driver.test.ts` — replace negative test with positive multi-frame test
- `packages/bridge/src/bridge.ts` — call `registerAutopilotTxIfEnabled(driver)` for the first YDWG driver
- `packages/core/src/index.ts` — re-export from `autopilot-tx.ts`
- `packages/web/src/app/autopilot/page.tsx` — convert to Server Component shell

---

### Task 1: Fast Packet split helper

**Files:**
- Create: `packages/bridge/src/tx/fast-packet.ts`
- Create: `packages/bridge/src/tx/fast-packet.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/src/tx/fast-packet.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import canboat from '@canboat/canboatjs';
import { parseActisenseFrameLines } from './fast-packet.js';

const { pgnToActisenseSerialFormat } = canboat as unknown as {
  pgnToActisenseSerialFormat: (pgn: {
    pgn: number;
    prio?: number;
    dst?: number;
    src?: number;
    fields: Record<string, unknown>;
  }) => string;
};

describe('parseActisenseFrameLines', () => {
  it('splits a Fast Packet PGN 130850 into 2 ordered frames', () => {
    const encoded = pgnToActisenseSerialFormat({
      pgn: 130850,
      prio: 3,
      dst: 255,
      src: 254,
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        Address: 0,
        'Proprietary ID': 'Autopilot',
        'Command Type': 'AP Command',
        Event: 'Standby',
      },
    });
    expect(encoded).toBeTruthy();
    const frames = parseActisenseFrameLines(encoded);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    // Each frame's order byte (data[0]) has frame# in bits 0-4; expect 0, 1, 2, ...
    frames.forEach((f, i) => {
      expect(f.data[0]! & 0x1f).toBe(i);
    });
    // Frame 0's byte 1 encodes total payload length; PGN 130850 PropID=255 with
    // Event=Standby is 11 bytes per canboat.
    expect(frames[0]!.data[1]).toBe(11);
  });

  it('passes single-frame PGN 60928 through as exactly 1 frame', () => {
    const encoded = pgnToActisenseSerialFormat({
      pgn: 60928,
      prio: 6,
      dst: 255,
      src: 254,
      fields: {
        'Unique Number': 0,
        'Manufacturer Code': 'Simrad',
        'Device Instance Lower': 0,
        'Device Instance Upper': 0,
        'Device Function': 130,
        'Device Class': 'Steering and Control surfaces',
        'System Instance': 0,
        'Industry Group': 'Marine',
      },
    });
    const frames = parseActisenseFrameLines(encoded);
    expect(frames).toHaveLength(1);
  });

  it('two consecutive PGN 130850 encodings use different sequence-number bits', () => {
    const fields = {
      'Manufacturer Code': 'Simrad',
      'Industry Code': 'Marine Industry',
      Address: 0,
      'Proprietary ID': 'Autopilot',
      'Command Type': 'AP Command',
      Event: 'Standby',
    };
    const a = parseActisenseFrameLines(pgnToActisenseSerialFormat({
      pgn: 130850, prio: 3, dst: 255, src: 254, fields,
    }));
    const b = parseActisenseFrameLines(pgnToActisenseSerialFormat({
      pgn: 130850, prio: 3, dst: 255, src: 254, fields,
    }));
    // Sequence bits = data[0] >> 5; should rotate between consecutive sends.
    expect(a[0]!.data[0]! >> 5).not.toBe(b[0]!.data[0]! >> 5);
  });

  it('rejects empty input', () => {
    expect(() => parseActisenseFrameLines('')).toThrow(/empty/i);
  });

  it('rejects unparseable line', () => {
    expect(() => parseActisenseFrameLines('garbage')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/bridge && npx vitest run src/tx/fast-packet.test.ts`
Expected: FAIL with "Cannot find module './fast-packet.js'" or similar.

- [ ] **Step 3: Implement parseActisenseFrameLines**

Create `packages/bridge/src/tx/fast-packet.ts`:

```typescript
import type { RawCanFrame } from '../wire-driver.js';
import { parseActisenseLine } from '../ngt-driver.js';

/**
 * Split canboatjs's multi-line Actisense output for a Fast Packet PGN
 * into ordered RawCanFrames. canboatjs emits one trace line per CAN
 * frame, with the NMEA-2000 Fast Packet order byte (sequence in
 * top 3 bits, frame# in bottom 5 bits) already baked into byte 0.
 *
 * Asserts frame# is strictly ascending starting at 0 — guards against
 * canboatjs ever emitting out-of-order lines.
 */
export function parseActisenseFrameLines(encoded: string): RawCanFrame[] {
  if (!encoded || encoded.trim().length === 0) {
    throw new Error('parseActisenseFrameLines: empty input');
  }
  const lines = encoded
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const frames: RawCanFrame[] = [];
  for (const line of lines) {
    const f = parseActisenseLine(line);
    if (!f) {
      throw new Error(`parseActisenseFrameLines: failed to parse line: ${line}`);
    }
    frames.push(f);
  }
  if (frames.length > 1) {
    // Multi-frame: assert frame# (low 5 bits of data[0]) is strictly ascending.
    frames.forEach((f, i) => {
      const frameNum = f.data[0]! & 0x1f;
      if (frameNum !== i) {
        throw new Error(
          `parseActisenseFrameLines: frame ${i} has frame# ${frameNum}, expected ${i}`,
        );
      }
    });
  }
  return frames;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/bridge && npx vitest run src/tx/fast-packet.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/tx/fast-packet.ts packages/bridge/src/tx/fast-packet.test.ts
git commit -m "$(printf 'feat(bridge): Fast Packet split helper\n\nPure parseActisenseFrameLines() that turns canboatjs multi-line\nActisense output into ordered RawCanFrames. Asserts strict frame-\nnumber ordering. Reused by the YDWG driver in the next task.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Wire YDWG driver's `txPgn` to use the helper

**Files:**
- Modify: `packages/bridge/src/ydwg-raw-tcp-driver.ts` (lines ~165–205)
- Modify: `packages/bridge/src/ydwg-raw-tcp-driver.test.ts` (lines ~265–280)

- [ ] **Step 1: Rewrite the failing-on-multi-frame test as a positive test**

Find the existing `it('txPgn throws for Fast Packet PGNs ...')` test in `packages/bridge/src/ydwg-raw-tcp-driver.test.ts` (around line 268) and replace it with:

```typescript
  it('txPgn writes ordered frames for Fast Packet PGN 130850', async () => {
    await driver.txPgn({
      pgn: 130850,
      prio: 3,
      dst: 255,
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        Address: 0,
        'Proprietary ID': 'Autopilot',
        'Command Type': 'AP Command',
        Event: 'Standby',
      },
    });
    // PGN 130850 PropID=255 Event=Standby is 11 bytes = 2 Fast Packet frames.
    expect(socket.writes.length).toBe(2);
    socket.writes.forEach((line) => {
      expect(line).toMatch(/^[0-9A-F]{8}( [0-9A-F]{2})+\r\n$/);
    });
    // Frame counters (low 5 bits of first data byte) should be 0, 1.
    const dataByte0 = (line: string): number => {
      const parts = line.trim().split(/\s+/);
      return parseInt(parts[1]!, 16);
    };
    expect(dataByte0(socket.writes[0]!) & 0x1f).toBe(0);
    expect(dataByte0(socket.writes[1]!) & 0x1f).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bridge && npx vitest run src/ydwg-raw-tcp-driver.test.ts -t "Fast Packet PGN 130850"`
Expected: FAIL — either the old "throws" branch fires, or the assertion `socket.writes.length === 2` fails.

- [ ] **Step 3: Rewrite `txPgn` to use the helper**

In `packages/bridge/src/ydwg-raw-tcp-driver.ts`, replace the existing `txPgn` body (lines ~165 down through the `await this.txCan(frame)` call near line 200) with:

```typescript
  async txPgn(pgn: OutgoingPgn): Promise<void> {
    // Encode via canboatjs and split into ordered Fast Packet frames.
    // canboatjs's Actisense output bakes the order byte (sequence + frame#)
    // into byte 0 of each frame; we just emit them in order via txCan.
    //
    // `src` defaults to 254 (J1939 "null address") since the g5000 has not
    // claimed an N2K address. Diagnostic / ISO-Request traffic accepts this.
    const encoded = pgnToActisenseSerialFormat({
      pgn: pgn.pgn,
      prio: pgn.prio ?? 6,
      dst: pgn.dst ?? 255,
      src: 254,
      fields: pgn.fields,
    });
    if (!encoded) {
      throw new Error(`YdwgRawTcpDriver.txPgn: canboatjs returned empty encoding for PGN ${pgn.pgn}`);
    }
    const frames = parseActisenseFrameLines(encoded);
    for (const frame of frames) {
      await this.txCan(frame);
    }
  }
```

Then add the import at the top of the file (after the other imports):

```typescript
import { parseActisenseFrameLines } from './tx/fast-packet.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bridge && npx vitest run src/ydwg-raw-tcp-driver.test.ts -t "Fast Packet PGN 130850"`
Expected: PASS.

- [ ] **Step 5: Run the full bridge test suite to catch regressions**

Run: `cd packages/bridge && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/ydwg-raw-tcp-driver.ts packages/bridge/src/ydwg-raw-tcp-driver.test.ts
git commit -m "$(printf 'feat(bridge): YDWG txPgn supports Fast Packet PGNs\n\nReplaces the explicit throw on multi-frame PGNs with a call into\nthe parseActisenseFrameLines helper, then emits each frame via the\nexisting txCan path. Unlocks PGN 130850 transmission for the AP\ntest controls work.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: AutopilotTx interface + singleton in core

**Files:**
- Create: `packages/core/src/autopilot-tx.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the interface file**

Create `packages/core/src/autopilot-tx.ts`:

```typescript
/**
 * Shared interface + globalThis-backed singleton for transmitting
 * autopilot commands onto the N2K bus. Same pattern as alerts.ts:
 * the bridge writes (registers the impl at boot), web routes read.
 *
 * Only registered when process.env.G5000_ENABLE_AP_TX === '1', which
 * is the Mac dev environment. The Pi's g5000-autopilot.service must
 * never set this var.
 */

export type AutopilotCommandName =
  | 'standby'
  | 'auto'
  | 'nav'
  | 'wind'
  | 'no_drift'
  | 'course_+1'
  | 'course_-1'
  | 'course_+10'
  | 'course_-10';

export interface AutopilotCommandRequest {
  event: AutopilotCommandName;
}

export interface AutopilotCommandResult {
  ok: boolean;
  /** Wall-clock ms taken for the txPgn call to resolve. */
  txMs?: number;
  /** Set when ok=false. */
  error?: { kind: 'missing_capture' | 'tx_error' | 'unknown_event'; message: string };
}

export interface AutopilotTx {
  sendCommand(req: AutopilotCommandRequest): Promise<AutopilotCommandResult>;
}

declare const globalThis: { __g5000_autopilot_tx__?: AutopilotTx };

export function getSharedAutopilotTx(): AutopilotTx | undefined {
  return globalThis.__g5000_autopilot_tx__;
}

export function setSharedAutopilotTx(tx: AutopilotTx): void {
  globalThis.__g5000_autopilot_tx__ = tx;
}

export function _resetAutopilotTxForTests(): void {
  globalThis.__g5000_autopilot_tx__ = undefined;
}
```

- [ ] **Step 2: Re-export from the package index**

Open `packages/core/src/index.ts`. Find the existing alerts re-export block and add directly below it:

```typescript
export * from './autopilot-tx.js';
```

- [ ] **Step 3: Build core and verify it compiles**

Run: `cd packages/core && npx tsc -b`
Expected: No errors. `dist/autopilot-tx.d.ts` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/autopilot-tx.ts packages/core/src/index.ts
git commit -m "$(printf 'feat(core): AutopilotTx interface + globalThis singleton\n\nSame globalThis pattern as alerts.ts. Bridge will register the impl\nat boot when G5000_ENABLE_AP_TX=1; web API routes call into it via\ngetSharedAutopilotTx(). The Pi systemd unit never sets this var so\nthe singleton stays undefined there.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Command resolver (event-name → PGN field-bag)

**Files:**
- Create: `packages/bridge/src/autopilot-commands.ts`
- Create: `packages/bridge/src/autopilot-commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/src/autopilot-commands.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveCommand } from './autopilot-commands.js';

describe('resolveCommand', () => {
  it('resolves standby to canboat-documented Event=6 fields', () => {
    const r = resolveCommand('standby', { version: 1, captures: {} });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields['Proprietary ID']).toBe('Autopilot');
      expect(r.fields['Command Type']).toBe('AP Command');
      expect(r.fields['Event']).toBe('Standby');
    }
  });

  it('resolves auto to Event=Heading mode', () => {
    const r = resolveCommand('auto', { version: 1, captures: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields['Event']).toBe('Heading mode');
  });

  it('resolves nav / wind / no_drift to their canboat Events', () => {
    expect(resolveCommand('nav', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'Nav mode' }),
    });
    expect(resolveCommand('wind', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'Wind mode' }),
    });
    expect(resolveCommand('no_drift', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'No Drift mode' }),
    });
  });

  it('returns missing_capture when course_+1 has no capture entry', () => {
    const r = resolveCommand('course_+1', { version: 1, captures: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('missing_capture');
  });

  it('returns the capture fields when course_+1 has an entry', () => {
    const r = resolveCommand('course_+1', {
      version: 1,
      captures: {
        'course_+1': { fields: { 'Proprietary ID': 'Autopilot', Event: 'Change course', Direction: 'Starboard', Angle: 1 } },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields['Direction']).toBe('Starboard');
      expect(r.fields['Angle']).toBe(1);
    }
  });

  it('rejects unknown_event', () => {
    // @ts-expect-error testing the runtime guard
    const r = resolveCommand('bogus', { version: 1, captures: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unknown_event');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/bridge && npx vitest run src/autopilot-commands.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the resolver**

Create `packages/bridge/src/autopilot-commands.ts`:

```typescript
import type { AutopilotCommandName } from '@g5000/core';

export interface CaptureEntry {
  /** Canboatjs field-bag for PGN 130850. Hand-edited after /sniff capture. */
  fields: Record<string, unknown>;
}

export interface CaptureCodes {
  version: 1;
  captures: Partial<Record<AutopilotCommandName, CaptureEntry>>;
}

export type ResolveResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; kind: 'missing_capture' | 'unknown_event'; message: string };

/**
 * Map a command name to the PGN 130850 field-bag for txPgn.
 *
 * - standby / auto / nav / wind / no_drift use canboat-documented Event IDs
 *   under Proprietary ID=Autopilot, Command Type=AP Command.
 * - course_+1 / course_-1 / course_+10 / course_-10 must come from
 *   captureCodes (hand-edited from /sniff captures) — they use Event=26
 *   Change course but the magnitude/direction encoding is undocumented.
 */
export function resolveCommand(
  event: AutopilotCommandName,
  captureCodes: CaptureCodes,
): ResolveResult {
  const builtin: Record<string, string> = {
    standby: 'Standby',
    auto: 'Heading mode',
    nav: 'Nav mode',
    wind: 'Wind mode',
    no_drift: 'No Drift mode',
  };
  if (event in builtin) {
    return {
      ok: true,
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        Address: 0,
        'Proprietary ID': 'Autopilot',
        'Command Type': 'AP Command',
        Event: builtin[event]!,
      },
    };
  }
  if (
    event === 'course_+1' ||
    event === 'course_-1' ||
    event === 'course_+10' ||
    event === 'course_-10'
  ) {
    const entry = captureCodes.captures[event];
    if (!entry) {
      return {
        ok: false,
        kind: 'missing_capture',
        message: `no capture entry for ${event} — add it to ~/.g5000-router/ap-tx-codes.json after /sniff capture`,
      };
    }
    return { ok: true, fields: entry.fields };
  }
  return {
    ok: false,
    kind: 'unknown_event',
    message: `unknown autopilot event: ${String(event)}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/bridge && npx vitest run src/autopilot-commands.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/autopilot-commands.ts packages/bridge/src/autopilot-commands.test.ts
git commit -m "$(printf 'feat(bridge): autopilot command resolver\n\nPure resolveCommand(event, captureCodes) returning a PGN 130850\nfield-bag. Built-in events (standby/auto/nav/wind/no_drift) use\ncanboat-documented Event values; course_+/-1 / +/-10 require\ncaptured codes from /sniff.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Capture-codes file reader

**Files:**
- Create: `packages/bridge/src/capture-codes.ts`
- Create: `packages/bridge/src/capture-codes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/src/capture-codes.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readCaptureCodes } from './capture-codes.js';

describe('readCaptureCodes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-codes-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty captures when file is missing', async () => {
    const r = await readCaptureCodes(path.join(tmpDir, 'missing.json'));
    expect(r).toEqual({ version: 1, captures: {} });
  });

  it('parses a well-formed file', async () => {
    const p = path.join(tmpDir, 'codes.json');
    await fs.writeFile(p, JSON.stringify({
      version: 1,
      captures: {
        'course_+1': { fields: { Event: 'Change course', Direction: 'Starboard', Angle: 1 } },
      },
    }));
    const r = await readCaptureCodes(p);
    expect(r.captures['course_+1']?.fields['Direction']).toBe('Starboard');
  });

  it('returns empty captures (with a console warning) on parse error', async () => {
    const p = path.join(tmpDir, 'bad.json');
    await fs.writeFile(p, '{ not valid json');
    const r = await readCaptureCodes(p);
    expect(r).toEqual({ version: 1, captures: {} });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/bridge && npx vitest run src/capture-codes.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the reader**

Create `packages/bridge/src/capture-codes.ts`:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CaptureCodes } from './autopilot-commands.js';

export const DEFAULT_CAPTURE_CODES_PATH = path.join(
  process.env.G5000_ROUTER_ROOT ?? path.join(os.homedir(), '.g5000-router'),
  'ap-tx-codes.json',
);

/**
 * Read the AP transmit capture-codes file. Returns an empty CaptureCodes
 * object (rather than throwing) when the file is missing or unparseable,
 * so the API route can treat "missing capture" as a normal state.
 */
export async function readCaptureCodes(
  filePath: string = DEFAULT_CAPTURE_CODES_PATH,
): Promise<CaptureCodes> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return { version: 1, captures: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureCodes>;
    return {
      version: 1,
      captures: parsed.captures ?? {},
    };
  } catch (e) {
    console.warn('[capture-codes] failed to parse file, treating as empty:', (e as Error).message);
    return { version: 1, captures: {} };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/bridge && npx vitest run src/capture-codes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/capture-codes.ts packages/bridge/src/capture-codes.test.ts
git commit -m "$(printf 'feat(bridge): read AP capture-codes file\n\nReads ~/.g5000-router/ap-tx-codes.json (or G5000_ROUTER_ROOT/ap-tx-\ncodes.json). Returns empty captures when missing or unparseable so\nthe API path can treat \"missing capture\" as a normal flow.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: AutopilotTx implementation + Fastpath registration helper

**Files:**
- Create: `packages/bridge/src/autopilot-tx-impl.ts`
- Create: `packages/bridge/src/autopilot-tx-impl.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/src/autopilot-tx-impl.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAutopilotTxForTests, getSharedAutopilotTx } from '@g5000/core';
import {
  createAutopilotTx,
  registerAutopilotTxIfEnabled,
} from './autopilot-tx-impl.js';
import type { WireDriver } from './wire-driver.js';

function fakeDriver(): WireDriver & { txPgnSpy: ReturnType<typeof vi.fn> } {
  const txPgnSpy = vi.fn().mockResolvedValue(undefined);
  return {
    txPgnSpy,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    rxCan: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    rx0183: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    health$: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    txCan: vi.fn().mockResolvedValue(undefined),
    tx0183: vi.fn().mockResolvedValue(undefined),
    txPgn: txPgnSpy,
  } as unknown as WireDriver & { txPgnSpy: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  _resetAutopilotTxForTests();
  delete process.env.G5000_ENABLE_AP_TX;
});

describe('createAutopilotTx', () => {
  it('sends standby through txPgn with PGN 130850 + Event=Standby', async () => {
    const driver = fakeDriver();
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'standby' });
    expect(r.ok).toBe(true);
    expect(driver.txPgnSpy).toHaveBeenCalledOnce();
    const arg = driver.txPgnSpy.mock.calls[0]![0]!;
    expect(arg.pgn).toBe(130850);
    expect(arg.fields.Event).toBe('Standby');
  });

  it('returns missing_capture for course_+1 with no captures', async () => {
    const driver = fakeDriver();
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'course_+1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error?.kind).toBe('missing_capture');
    expect(driver.txPgnSpy).not.toHaveBeenCalled();
  });

  it('returns tx_error when driver.txPgn rejects', async () => {
    const driver = fakeDriver();
    driver.txPgnSpy.mockRejectedValueOnce(new Error('socket dead'));
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'standby' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error?.kind).toBe('tx_error');
      expect(r.error?.message).toContain('socket dead');
    }
  });

  it('serializes concurrent sendCommand calls', async () => {
    const driver = fakeDriver();
    let inflight = 0;
    let maxInflight = 0;
    driver.txPgnSpy.mockImplementation(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
    });
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    await Promise.all([
      tx.sendCommand({ event: 'standby' }),
      tx.sendCommand({ event: 'auto' }),
      tx.sendCommand({ event: 'standby' }),
    ]);
    expect(maxInflight).toBe(1);
    expect(driver.txPgnSpy).toHaveBeenCalledTimes(3);
  });
});

describe('registerAutopilotTxIfEnabled', () => {
  it('does not register when G5000_ENABLE_AP_TX is unset', () => {
    delete process.env.G5000_ENABLE_AP_TX;
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeUndefined();
  });

  it('does not register when G5000_ENABLE_AP_TX is set to something other than "1"', () => {
    process.env.G5000_ENABLE_AP_TX = '0';
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeUndefined();
  });

  it('registers when G5000_ENABLE_AP_TX === "1"', () => {
    process.env.G5000_ENABLE_AP_TX = '1';
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/bridge && npx vitest run src/autopilot-tx-impl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory + helper**

Create `packages/bridge/src/autopilot-tx-impl.ts`:

```typescript
import {
  setSharedAutopilotTx,
  type AutopilotTx,
  type AutopilotCommandRequest,
  type AutopilotCommandResult,
} from '@g5000/core';
import type { WireDriver } from './wire-driver.js';
import { resolveCommand, type CaptureCodes } from './autopilot-commands.js';
import { readCaptureCodes as defaultReadCaptureCodes } from './capture-codes.js';

export interface CreateAutopilotTxOpts {
  driver: WireDriver;
  /** Override for tests — defaults to reading the file on each sendCommand. */
  readCaptureCodes?: () => Promise<CaptureCodes>;
}

/**
 * Constructs an AutopilotTx that sends PGN 130850 frames via the given
 * WireDriver. Reads the capture-codes file on every call (cheap; small JSON).
 * Single-in-flight serialization prevents interleaved Fast Packet sequences.
 */
export function createAutopilotTx(opts: CreateAutopilotTxOpts): AutopilotTx {
  const read = opts.readCaptureCodes ?? defaultReadCaptureCodes;
  let inflight: Promise<unknown> = Promise.resolve();

  async function send(req: AutopilotCommandRequest): Promise<AutopilotCommandResult> {
    const captureCodes = await read();
    const resolved = resolveCommand(req.event, captureCodes);
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          kind: resolved.kind,
          message: resolved.message,
        },
      };
    }
    const t0 = Date.now();
    try {
      await opts.driver.txPgn({
        pgn: 130850,
        prio: 3,
        dst: 255,
        fields: resolved.fields,
      });
      return { ok: true, txMs: Date.now() - t0 };
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: 'tx_error',
          message: (e as Error).message,
        },
      };
    }
  }

  return {
    sendCommand: (req) => {
      const next = inflight.then(() => send(req));
      // Keep the chain alive but don't propagate rejection — each call returns its own result.
      inflight = next.catch(() => undefined);
      return next;
    },
  };
}

/**
 * Boot-time helper. Registers the AutopilotTx singleton only when the
 * G5000_ENABLE_AP_TX env var is set to the literal string "1". On the Pi
 * the variable is unset; the singleton stays undefined and every API
 * route call returns 503.
 */
export function registerAutopilotTxIfEnabled(driver: WireDriver): void {
  if (process.env.G5000_ENABLE_AP_TX !== '1') {
    console.log('[autopilot-tx] disabled (G5000_ENABLE_AP_TX != "1")');
    return;
  }
  setSharedAutopilotTx(createAutopilotTx({ driver }));
  console.log('[autopilot-tx] enabled — AP commands ARE transmitted to the live bus');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/bridge && npx vitest run src/autopilot-tx-impl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/autopilot-tx-impl.ts packages/bridge/src/autopilot-tx-impl.test.ts
git commit -m "$(printf 'feat(bridge): AutopilotTx implementation + boot-time gate\n\ncreateAutopilotTx(driver) builds an impl with single-in-flight\nserialization. registerAutopilotTxIfEnabled() only registers the\nshared singleton when G5000_ENABLE_AP_TX=1, so the Pi can never\naccidentally transmit.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Wire the registration into the bridge boot

**Files:**
- Modify: `packages/bridge/src/bridge.ts`

- [ ] **Step 1: Add the registration call**

Open `packages/bridge/src/bridge.ts`. After the `await Promise.all(drivers.map((d) => d.start()));` line (around line 27), add:

```typescript
  // AP TX is disabled by default. Mac dev enables it by setting
  // G5000_ENABLE_AP_TX=1 before launching the autopilot server.
  if (drivers.length > 0) {
    registerAutopilotTxIfEnabled(drivers[0]!);
  }
```

Then add the import at the top of the file (next to the existing imports):

```typescript
import { registerAutopilotTxIfEnabled } from './autopilot-tx-impl.js';
```

- [ ] **Step 2: Build the package and verify**

Run: `cd packages/bridge && npx tsc -b`
Expected: No errors.

- [ ] **Step 3: Run the bridge test suite**

Run: `cd packages/bridge && npx vitest run`
Expected: All tests pass; no new failures.

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/bridge.ts
git commit -m "$(printf 'feat(bridge): register AutopilotTx singleton at boot\n\nWires registerAutopilotTxIfEnabled into runBridge using the first\ndriver. With G5000_ENABLE_AP_TX unset (the Pi default) this is a\nlog-and-return; with G5000_ENABLE_AP_TX=1 the AP TX singleton is\nbound and web API routes can call into it.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: API route `/api/autopilot/command`

**Files:**
- Create: `packages/web/src/app/api/autopilot/command/route.ts`

- [ ] **Step 1: Implement the route**

Create `packages/web/src/app/api/autopilot/command/route.ts`:

```typescript
import { getSharedAutopilotTx, type AutopilotCommandName } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_EVENTS: AutopilotCommandName[] = [
  'standby', 'auto', 'nav', 'wind', 'no_drift',
  'course_+1', 'course_-1', 'course_+10', 'course_-10',
];

interface Body {
  event: AutopilotCommandName;
}

/**
 * POST /api/autopilot/command — sends a PGN 130850 frame to the H5000.
 *
 * Three layers of gating, in order:
 *  1. process.env.G5000_ENABLE_AP_TX must be "1" (403 otherwise)
 *  2. The shared AutopilotTx singleton must be registered (503 otherwise)
 *  3. The command resolver / driver may still reject (200 + ok:false body)
 *
 * Body: { event: 'standby' | 'auto' | ... }. See AutopilotCommandName.
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.G5000_ENABLE_AP_TX !== '1') {
    return Response.json(
      { ok: false, error: { kind: 'forbidden', message: 'AP TX disabled in this environment' } },
      { status: 403 },
    );
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }
  if (!VALID_EVENTS.includes(body.event)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: `invalid event: ${String(body.event)}` } },
      { status: 400 },
    );
  }
  const tx = getSharedAutopilotTx();
  if (!tx) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'AP TX not registered (bridge not booted with G5000_ENABLE_AP_TX=1)' } },
      { status: 503 },
    );
  }
  const r = await tx.sendCommand({ event: body.event });
  if (r.ok) {
    return Response.json({ ok: true, txMs: r.txMs });
  }
  return Response.json(
    { ok: false, error: r.error },
    { status: 502 },
  );
}
```

- [ ] **Step 2: Typecheck the web package**

Run: `cd packages/web && npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Manual smoke (Mac dev only — boat-side test)**

Confirm dev server is up: `curl http://localhost:3000/api/autopilot/command -X POST -H 'Content-Type: application/json' -d '{"event":"standby"}'`

Two valid outcomes depending on the dev server's env:
- If `G5000_ENABLE_AP_TX=1`: `{ ok: true, txMs: N }` and the AP transitions to Standby on the helm.
- If unset: `{ ok: false, error: { kind: 'forbidden', ... } }` with HTTP 403.

**STOP HERE AND ASK** before doing the first live send if the AP is currently engaged.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/autopilot/command/route.ts
git commit -m "$(printf 'feat(web): POST /api/autopilot/command\n\nMac-only AP command endpoint. Three-layer env-var gate (403 if\nG5000_ENABLE_AP_TX!=1, 503 if singleton unregistered, 502 if the\ntx layer rejects). Body { event: name } and the singleton resolves\nthat to a PGN 130850 field-bag.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: API route `/api/autopilot/capture-codes`

**Files:**
- Create: `packages/web/src/app/api/autopilot/capture-codes/route.ts`

- [ ] **Step 1: Implement the route**

Create `packages/web/src/app/api/autopilot/capture-codes/route.ts`:

```typescript
import { readCaptureCodes } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/autopilot/capture-codes — returns the contents of the
 * AP-TX capture-codes file (~/.g5000-router/ap-tx-codes.json) so the
 * /autopilot UI can grey out buttons whose Triton-captured frames
 * haven't been hand-added to the file yet.
 *
 * Returns an empty captures object when the file is missing or
 * unparseable. Always 200 — this is a UI hint, not an action.
 */
export async function GET(): Promise<Response> {
  const codes = await readCaptureCodes();
  return Response.json(codes);
}
```

- [ ] **Step 2: Export readCaptureCodes from @g5000/bridge**

Open `packages/bridge/src/index.ts`. Add (alongside the other re-exports):

```typescript
export { readCaptureCodes } from './capture-codes.js';
export type { CaptureCodes, CaptureEntry } from './autopilot-commands.js';
```

- [ ] **Step 3: Build bridge so web can consume the new export**

Run: `cd packages/bridge && npx tsc -b`
Expected: No errors. `dist/capture-codes.js` exists.

- [ ] **Step 4: Typecheck web**

Run: `cd packages/web && npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 5: Manual smoke**

Run: `curl http://localhost:3000/api/autopilot/capture-codes`
Expected: `{"version":1,"captures":{}}` (assuming no file written yet).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/autopilot/capture-codes/route.ts packages/bridge/src/index.ts
git commit -m "$(printf 'feat(web): GET /api/autopilot/capture-codes\n\nThin wrapper over readCaptureCodes() so the /autopilot UI can grey\nout buttons whose captured Triton frames are not yet in the file.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Control panel client component

**Files:**
- Create: `packages/web/src/app/autopilot/control-panel.tsx`

Build this BEFORE the page conversion so the tree never enters a non-building state. ControlPanel is self-contained — it does not depend on anything in page.tsx or readonly-view.tsx.

- [ ] **Step 1: Implement the client component**

Create `packages/web/src/app/autopilot/control-panel.tsx`:

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import type { AutopilotCommandName, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

interface LogRow {
  id: number;
  t: number;
  command: AutopilotCommandName;
  result: string;
}

const COMMANDS: { name: AutopilotCommandName; label: string; group: 'mode' | 'course'; description: string }[] = [
  { name: 'auto',       label: 'ENABLE (AUTO)', group: 'mode',   description: 'Engages heading-hold at the current vessel heading.' },
  { name: 'standby',    label: 'DISABLE (STBY)', group: 'mode',  description: 'Disengages active steering — boat falls back to manual / follow-up.' },
  { name: 'course_-10', label: '−10°',  group: 'course', description: 'Adjust target heading 10° to port.' },
  { name: 'course_-1',  label: '−1°',   group: 'course', description: 'Adjust target heading 1° to port.' },
  { name: 'course_+1',  label: '+1°',   group: 'course', description: 'Adjust target heading 1° to starboard.' },
  { name: 'course_+10', label: '+10°',  group: 'course', description: 'Adjust target heading 10° to starboard.' },
];

interface CaptureCodesResponse {
  version: 1;
  captures: Partial<Record<AutopilotCommandName, unknown>>;
}

export function ControlPanel(): React.ReactElement {
  const [captures, setCaptures] = useState<CaptureCodesResponse>({ version: 1, captures: {} });
  const [pendingCommand, setPendingCommand] = useState<AutopilotCommandName | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const logIdRef = useRef(0);
  const { channels } = useSse();

  useEffect(() => {
    fetch('/api/autopilot/capture-codes')
      .then((r) => r.json())
      .then((j) => setCaptures(j as CaptureCodesResponse))
      .catch(() => {});
  }, []);

  function isBuiltin(name: AutopilotCommandName): boolean {
    return name === 'standby' || name === 'auto' || name === 'nav' || name === 'wind' || name === 'no_drift';
  }

  function buttonEnabled(name: AutopilotCommandName): boolean {
    if (cooldownUntil > Date.now()) return false;
    if (isBuiltin(name)) return true;
    return Boolean(captures.captures[name]);
  }

  function buttonTooltip(name: AutopilotCommandName): string | undefined {
    if (!isBuiltin(name) && !captures.captures[name]) {
      return `Add captures.${name} to ~/.g5000-router/ap-tx-codes.json after /sniff capture.`;
    }
    return undefined;
  }

  async function confirmAndSend(name: AutopilotCommandName): Promise<void> {
    setPendingCommand(null);
    const t0 = Date.now();
    const modeBefore = channels.get('autopilot.mode') as JsonSafeSample | undefined;
    const modeBeforeValue =
      modeBefore?.value.kind === 'enum' ? modeBefore.value.value : null;

    let resultText: string;
    try {
      const resp = await fetch('/api/autopilot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: name }),
      });
      const body = (await resp.json()) as { ok: boolean; txMs?: number; error?: { kind: string; message: string } };
      if (!resp.ok || !body.ok) {
        const err = body.error;
        if (err?.kind === 'unavailable') resultText = 'bus down — check YDWG';
        else resultText = `TX error: ${err?.message ?? `HTTP ${resp.status}`}`;
      } else {
        // Best-effort ack: watch autopilot.mode for a change within 2 s.
        resultText = 'no mode change within 2 s';
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          const after = channels.get('autopilot.mode') as JsonSafeSample | undefined;
          const v = after?.value.kind === 'enum' ? after.value.value : null;
          if (v && v !== modeBeforeValue) {
            resultText = `mode→${v} (${Date.now() - t0} ms)`;
            break;
          }
        }
      }
    } catch (e) {
      resultText = `TX error: ${(e as Error).message}`;
    }
    setLog((prev) => [
      { id: ++logIdRef.current, t: Date.now() / 1000, command: name, result: resultText },
      ...prev,
    ].slice(0, 10));
    setCooldownUntil(Date.now() + 500);
  }

  return (
    <section className="border-t border-amber-800 pt-6 mt-6 space-y-4">
      <div className="bg-amber-900/30 border border-amber-700 rounded p-3 text-amber-100 text-sm space-y-2">
        <div className="font-semibold">⚠ TEST CONTROLS · MAC ONLY</div>
        <p>
          Sends real PGN 130850 frames to the live autopilot. Confirm each press.
          Increment buttons (±1°, ±10°) are disabled until the Triton keypad
          values are captured at <a href="/sniff" className="underline">/sniff</a>
          {' '}and added to <code>~/.g5000-router/ap-tx-codes.json</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">Mode</h3>
          <div className="grid grid-cols-2 gap-2">
            {COMMANDS.filter((c) => c.group === 'mode').map((c) => (
              <button
                key={c.name}
                type="button"
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onClick={() => setPendingCommand(c.name)}
                className="px-3 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded font-semibold text-slate-200"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">Course adjust</h3>
          <div className="grid grid-cols-4 gap-2">
            {COMMANDS.filter((c) => c.group === 'course').map((c) => (
              <button
                key={c.name}
                type="button"
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onClick={() => setPendingCommand(c.name)}
                className="px-2 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded font-mono text-slate-200"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingCommand && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded p-6 max-w-md space-y-4">
            <div className="text-lg font-semibold text-slate-100">Confirm AP command</div>
            <div className="text-sm text-slate-300">
              Send <span className="font-mono font-semibold">{COMMANDS.find((c) => c.name === pendingCommand)?.label}</span> to the autopilot?
            </div>
            <div className="text-xs text-slate-400">
              {COMMANDS.find((c) => c.name === pendingCommand)?.description}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCommand(null)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmAndSend(pendingCommand)}
                className="px-3 py-1 bg-amber-700 hover:bg-amber-600 rounded text-amber-50 text-sm font-semibold"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Recent commands</h3>
        <div className="text-xs font-mono space-y-1 text-slate-300">
          {log.length === 0 && <div className="text-slate-500 italic">No commands sent yet.</div>}
          {log.map((r) => {
            const d = new Date(r.t * 1000);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return (
              <div key={r.id} className="flex gap-3">
                <span className="text-slate-500">{`${hh}:${mm}:${ss}`}</span>
                <span className="font-semibold w-32">{COMMANDS.find((c) => c.name === r.command)?.label ?? r.command}</span>
                <span>→ {r.result}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck the web package**

Run: `cd packages/web && npx tsc --noEmit -p .`
Expected: No errors. (The page.tsx still imports ControlPanel only after Task 11 — typecheck stays clean because page.tsx isn't modified yet.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/autopilot/control-panel.tsx
git commit -m "$(printf 'feat(web,autopilot): Mac-only control panel + recent-commands log\n\nSix buttons (ENABLE/DISABLE/+/-1/+/-10), confirmation modal,\n500ms cooldown, and a 10-row send log that watches\nautopilot.mode for a state change within 2 s as a best-effort ack.\nIncrement buttons grey out until ap-tx-codes.json has the matching\ncapture entry. Not yet rendered by the page (Task 11 wires it).\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: Convert `/autopilot` to Server Component + extract read-only view + render ControlPanel

**Files:**
- Create: `packages/web/src/app/autopilot/readonly-view.tsx`
- Modify: `packages/web/src/app/autopilot/page.tsx`

- [ ] **Step 1: Extract the existing read-only content into a client component**

Create `packages/web/src/app/autopilot/readonly-view.tsx` containing the entire body of the current `AutopilotPage` (it's a client component already):

```typescript
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

const RAD_TO_DEG = 180 / Math.PI;

function fmtAngle(s: JsonSafeSample | undefined): string {
  if (!s || s.value.kind !== 'scalar') return '—';
  let deg = s.value.value * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(1)}°`;
}

function fmtRudder(s: JsonSafeSample | undefined): string {
  if (!s || s.value.kind !== 'scalar') return '—';
  const deg = s.value.value * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(1)}°`;
}

function fmtMode(s: JsonSafeSample | undefined): string {
  if (!s) return 'Unknown';
  if (s.value.kind === 'enum') return s.value.value;
  return 'Unknown';
}

function age(s: JsonSafeSample | undefined): string {
  if (!s) return '—';
  const sec = (Date.now() - s.t_ms) / 1000;
  return `${sec.toFixed(1)}s ago`;
}

export function ReadonlyView({ apTxEnabled }: { apTxEnabled: boolean }) {
  const { channels, connected } = useSse();

  const mode = channels.get('autopilot.mode');
  const targetHdg = channels.get('autopilot.target.heading');
  const targetTrack = channels.get('autopilot.target.track');
  const rudder = channels.get('autopilot.commandedRudder');
  const actualHdg = channels.get('autopilot.actual.heading');
  const vesselHdg = channels.get('boat.heading.magnetic');

  let headingError: number | null = null;
  if (targetHdg?.value.kind === 'scalar') {
    const tgt = targetHdg.value.value;
    let act: number | null = null;
    if (actualHdg?.value.kind === 'scalar') act = actualHdg.value.value;
    else if (vesselHdg?.value.kind === 'scalar') act = vesselHdg.value.value;
    if (act !== null) {
      let diff = tgt - act;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      headingError = diff;
    }
  }

  const modeIsActive = mode?.value.kind === 'enum' && mode.value.value !== 'Standby';

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Autopilot</h1>
        <div className="text-xs text-slate-500">{connected ? 'Connected' : 'Reconnecting…'}</div>
      </div>

      <section>
        <div
          className={`inline-block px-4 py-2 rounded text-2xl font-mono font-semibold ${
            modeIsActive ? 'bg-amber-600 text-slate-900' : 'bg-slate-700 text-slate-300'
          }`}
        >
          {fmtMode(mode)}
        </div>
        <div className="text-xs text-slate-500 mt-1">{age(mode)}</div>
      </section>

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-slate-400">Targets</h2>
          <div>
            <div className="text-xs text-slate-500">Target heading</div>
            <div className="text-3xl font-mono">{fmtAngle(targetHdg)}</div>
            <div className="text-xs text-slate-500">{age(targetHdg)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Target track</div>
            <div className="text-2xl font-mono">{fmtAngle(targetTrack)}</div>
            <div className="text-xs text-slate-500">{age(targetTrack)}</div>
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-slate-400">Actual</h2>
          <div>
            <div className="text-xs text-slate-500">Vessel heading (mag)</div>
            <div className="text-3xl font-mono">{fmtAngle(vesselHdg)}</div>
            <div className="text-xs text-slate-500">{age(vesselHdg)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Heading error (target − actual)</div>
            <div
              className={`text-2xl font-mono ${
                headingError !== null && Math.abs(headingError * RAD_TO_DEG) > 5
                  ? 'text-amber-400'
                  : 'text-slate-200'
              }`}
            >
              {headingError !== null
                ? `${headingError >= 0 ? '+' : ''}${(headingError * RAD_TO_DEG).toFixed(1)}°`
                : '—'}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Commanded rudder</h2>
        <div className="text-3xl font-mono">{fmtRudder(rudder)}</div>
        <div className="text-xs text-slate-500">{age(rudder)}</div>
      </section>

      {!apTxEnabled && (
        <section className="text-xs text-slate-500 pt-4 border-t border-slate-800 max-w-xl">
          Listen-only. The G5000 does not transmit any autopilot commands. All values above come from
          PGN 127237 broadcast by your H5000 (or other autopilot computer) on the N2K bus.
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 2: Replace `page.tsx` with a Server Component shell**

Overwrite `packages/web/src/app/autopilot/page.tsx`:

```typescript
import { ReadonlyView } from './readonly-view';
import { ControlPanel } from './control-panel';

export default function AutopilotPage() {
  const apTxEnabled = process.env.G5000_ENABLE_AP_TX === '1';

  return (
    <main className="p-6 space-y-6">
      <ReadonlyView apTxEnabled={apTxEnabled} />
      {apTxEnabled && <ControlPanel />}
    </main>
  );
}
```

- [ ] **Step 3: Build the web package**

Run: `cd packages/web && npx tsc --noEmit -p .`
Expected: No errors. ControlPanel was created in Task 10, so the import resolves cleanly.

- [ ] **Step 4: Manual smoke**

Reload the dev server's /autopilot page. With `G5000_ENABLE_AP_TX=1`:
- Read-only readouts appear unchanged (the listen-only footnote disappears).
- Below them, the amber warning + 6 buttons appear. ENABLE and DISABLE active. Increment buttons greyed with tooltip mentioning ap-tx-codes.json.
- Click ENABLE → modal appears. Cancel → modal closes, no send. Confirm → recent-commands log shows the send and either `mode→Heading (NN ms)` or `no mode change within 2 s`.

Without `G5000_ENABLE_AP_TX=1`: only the readouts + the listen-only note remain; no buttons.

**STOP HERE** before the first real click if the AP is currently engaged. Coordinate with the helm.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/autopilot/page.tsx packages/web/src/app/autopilot/readonly-view.tsx
git commit -m "$(printf 'feat(web,autopilot): wire control panel into Server Component shell\n\nSplits the read-only readouts into a client component, makes the\npage a Server Component that reads G5000_ENABLE_AP_TX, and renders\nControlPanel below the readouts when the flag is set. Pi never\nsees the buttons because the env var is never set there.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---


## Self-review notes

- All 14 spec requirements (Section 3 files manifest) are covered by tasks 1-11.
- TX path: Tasks 1-2 (Fast Packet) → Tasks 3-7 (singleton + impl + boot) → Task 8 (API) → Tasks 10-11 (UI).
- Capture-codes path: Tasks 4-5 (resolver + reader) → Task 9 (API) → Task 11 (UI grey-out).
- Three-layer gate verified by Task 6 tests (boot), Task 8 code (API), Task 10 code (UI).
- No placeholders; every step contains executable code or commands.
- Manual smoke steps include explicit STOP-AND-ASK before first real AP send.
