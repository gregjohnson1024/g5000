# G5000 Plan 9 — Autopilot Listen-Only Decode + Status Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Decode the standard NMEA 2000 autopilot PGN (127237 — Heading/Track Control) into bus channels and build a `/autopilot` page that displays the current autopilot state live. **No TX, no commands.** This is the foundation for shadow-mode and eventually live engagement (spec phases 0b/0c), but for now it's pure observation — see what your H5000 is doing.

**Architecture:**
- Add `Channels.Autopilot.{Mode, TargetHeading, CommandedRudder, ActualHeading}` channel constants to `@g5000/core`.
- Extend the N2K channel mapper in `@g5000/bridge/src/channel-mapper.ts` to handle PGN 127237 fields.
- New `/autopilot` page subscribes to the SSE stream, renders mode + target heading + commanded rudder big and clearly.
- No backend pipeline changes (channel mapper is already wired into runBridge).

**Tech stack additions:** none.

**What's deferred (Plan 10+):**
- B&G proprietary autopilot PGNs (65302, 65305, 65360, 65371, 65379, 65384). The field names canboatjs uses for these are uncertain without captured boat data; landing them now risks silent miscoding. After the field test we'll have real frames and can verify.
- TX of any autopilot PGN. Strict listen-only this plan.
- Shadow-mode diff tool. Plan 11.
- Engagement UI. Plan 12+.

---

## Files

```
autopilot/
└── packages/
    ├── core/
    │   └── src/
    │       └── channels.ts                            MODIFY: add Autopilot.*
    ├── bridge/
    │   └── src/
    │       ├── channel-mapper.ts                      MODIFY: add 127237 mapper
    │       └── channel-mapper.test.ts                 MODIFY: add tests for 127237
    └── web/
        └── src/app/
            └── autopilot/
                └── page.tsx                           NEW
```

---

## Task 1: Autopilot channel constants

**Files:**
- Modify: `packages/core/src/channels.ts` — add `Autopilot` block

### Step 1: Add to `channels.ts`

Append to the existing `Channels` object literal:

```ts
  Autopilot: {
    /** Steering mode (enum from PGN 127237: "Heading Control", "Track Control", etc.). */
    Mode: 'autopilot.mode',
    /** Heading-To-Steer in radians [0, 2π). */
    TargetHeading: 'autopilot.target.heading',
    /** Commanded rudder angle in radians (signed; +stbd, -port). */
    CommandedRudder: 'autopilot.commandedRudder',
    /** Vessel heading per autopilot's own reference, radians. */
    ActualHeading: 'autopilot.actual.heading',
    /** Track-to-steer in radians when in Track Control mode. */
    TargetTrack: 'autopilot.target.track',
  },
```

### Step 2: Rebuild core dist (web consumes via dist)

```
npm run build --workspace=@g5000/core
```

### Step 3: Commit

```bash
git add packages/core/src/channels.ts
git commit -m "feat(core): add Channels.Autopilot.* constants"
```

---

## Task 2: PGN 127237 channel mapper (TDD)

**Files:**
- Modify: `packages/bridge/src/channel-mapper.ts` — add 127237 entry
- Modify: `packages/bridge/src/channel-mapper.test.ts` — add tests

PGN 127237 (Heading/Track Control) is a fast-packet PGN with many fields. canboatjs decodes it into a `fields` object keyed by the canboat field names. Most useful subset:

- `Steering Mode` (string enum) → `autopilot.mode`
- `Heading-To-Steer (Course)` (number, radians) → `autopilot.target.heading`
- `Commanded Rudder Angle` (number, radians) → `autopilot.commandedRudder`
- `Vessel Heading` (number, radians) → `autopilot.actual.heading`
- `Track` (number, radians) → `autopilot.target.track`

We translate whatever subset of these fields canboatjs actually delivers.

### Step 1: Add tests

In `packages/bridge/src/channel-mapper.test.ts`, append to the existing `describe('mapPgnToSamples', ...)` block:

```ts
  it('maps PGN 127237 steering mode to autopilot.mode', () => {
    const decoded = make(127237, {
      'Steering Mode': 'Heading Control',
      'Heading-To-Steer (Course)': 1.234,
      'Commanded Rudder Angle': -0.05,
      'Vessel Heading': 1.220,
    });
    const samples = mapPgnToSamples(decoded);
    const byCh = new Map(samples.map((s) => [s.channel, s]));
    expect(byCh.get(Channels.Autopilot.Mode)?.value).toEqual({
      kind: 'enum',
      value: 'Heading Control',
    });
    expect(byCh.get(Channels.Autopilot.TargetHeading)?.value).toEqual({
      kind: 'scalar',
      value: 1.234,
      unit: 'rad',
    });
    expect(byCh.get(Channels.Autopilot.CommandedRudder)?.value).toEqual({
      kind: 'scalar',
      value: -0.05,
      unit: 'rad',
    });
    expect(byCh.get(Channels.Autopilot.ActualHeading)?.value).toEqual({
      kind: 'scalar',
      value: 1.220,
      unit: 'rad',
    });
  });

  it('maps PGN 127237 with track field to autopilot.target.track', () => {
    const decoded = make(127237, {
      'Steering Mode': 'Track Control',
      Track: 0.5,
    });
    const samples = mapPgnToSamples(decoded);
    const byCh = new Map(samples.map((s) => [s.channel, s]));
    expect(byCh.get(Channels.Autopilot.TargetTrack)?.value).toEqual({
      kind: 'scalar',
      value: 0.5,
      unit: 'rad',
    });
  });

  it('omits missing fields gracefully', () => {
    const decoded = make(127237, {
      // Only mode present
      'Steering Mode': 'Standby',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = new Set(samples.map((s) => s.channel));
    expect(channels.has(Channels.Autopilot.Mode)).toBe(true);
    expect(channels.has(Channels.Autopilot.TargetHeading)).toBe(false);
  });
```

### Step 2: Run — expect failure

```
npx vitest run packages/bridge/src/channel-mapper.test.ts
```

### Step 3: Add the mapper entry

In `packages/bridge/src/channel-mapper.ts`, inside the `mappers` record, add after the existing entries:

```ts
  // PGN 127237 — Heading/Track Control (standard autopilot).
  // We surface a useful subset; canboatjs's decoded field names match the
  // canboat database conventions: "Steering Mode", "Heading-To-Steer (Course)",
  // "Commanded Rudder Angle", "Vessel Heading", "Track".
  127237: (pgn) => {
    const out: Sample[] = [];
    const mode = pgn.fields['Steering Mode'];
    if (typeof mode === 'string') {
      out.push({
        channel: Channels.Autopilot.Mode,
        t_ns: pgn.rxTimestamp,
        value: { kind: 'enum', value: mode },
        source: sourceTag(pgn),
      });
    }
    const targetHdg = pgn.fields['Heading-To-Steer (Course)'];
    if (typeof targetHdg === 'number') {
      out.push({
        channel: Channels.Autopilot.TargetHeading,
        t_ns: pgn.rxTimestamp,
        value: scalar(targetHdg, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const rudder = pgn.fields['Commanded Rudder Angle'];
    if (typeof rudder === 'number') {
      out.push({
        channel: Channels.Autopilot.CommandedRudder,
        t_ns: pgn.rxTimestamp,
        value: scalar(rudder, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const actualHdg = pgn.fields['Vessel Heading'];
    if (typeof actualHdg === 'number') {
      out.push({
        channel: Channels.Autopilot.ActualHeading,
        t_ns: pgn.rxTimestamp,
        value: scalar(actualHdg, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const track = pgn.fields['Track'];
    if (typeof track === 'number') {
      out.push({
        channel: Channels.Autopilot.TargetTrack,
        t_ns: pgn.rxTimestamp,
        value: scalar(track, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },
```

### Step 4: Run — expect pass

```
npx vitest run packages/bridge/src/channel-mapper.test.ts
```

3 new tests pass. Total channel-mapper tests should be ~11 (8 prior + 3 new).

### Step 5: Rebuild bridge dist

```
npm run build --workspace=@g5000/bridge
```

### Step 6: Commit

```bash
git add packages/bridge/src/channel-mapper.ts packages/bridge/src/channel-mapper.test.ts
git commit -m "feat(bridge): map PGN 127237 Heading/Track Control to autopilot channels"
```

---

## Task 3: `/autopilot` status page

**Files:**
- Create: `packages/web/src/app/autopilot/page.tsx`

A read-only status display. Big mode chip at top, then a 2-column layout: targets on the left, actuals on the right. Live SSE updates via the existing `useSse` hook.

### Step 1: Implement

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

const RAD_TO_DEG = 180 / Math.PI;

function fmtAngle(s: JsonSafeSample | undefined): string {
  if (!s || s.value.kind !== 'scalar') return '—';
  // Normalize to [0, 360) for displayed headings.
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

export default function AutopilotPage() {
  const { channels, connected } = useSse();

  const mode = channels.get('autopilot.mode');
  const targetHdg = channels.get('autopilot.target.heading');
  const targetTrack = channels.get('autopilot.target.track');
  const rudder = channels.get('autopilot.commandedRudder');
  const actualHdg = channels.get('autopilot.actual.heading');
  const vesselHdg = channels.get('boat.heading.magnetic');

  // Compute heading error (target − actual), normalized into [-π, π].
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
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Autopilot</h1>
        <div className="text-xs text-slate-500">
          {connected ? 'Connected' : 'Reconnecting…'}
        </div>
      </div>

      <section>
        <div
          className={`inline-block px-4 py-2 rounded text-2xl font-mono font-semibold ${
            modeIsActive
              ? 'bg-amber-600 text-slate-900'
              : 'bg-slate-700 text-slate-300'
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

      <section className="text-xs text-slate-500 pt-4 border-t border-slate-800 max-w-xl">
        Listen-only. The G5000 does not transmit any autopilot commands. All
        values above come from PGN 127237 broadcast by your H5000 (or other
        autopilot computer) on the N2K bus. If "Unknown" / "—" persists, your
        autopilot may use B&G-proprietary PGNs instead of (or in addition to)
        standard 127237 — those are decoded in a later plan.
      </section>
    </main>
  );
}
```

### Step 2: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 3: Commit

```bash
git add packages/web/src/app/autopilot/page.tsx
git commit -m "feat(web): /autopilot listen-only status page"
```

---

## Task 4: Final verification

- [ ] **Run full test suite + typecheck + lint + format**
- [ ] **Smoke-test `/autopilot` page** returns 200 with `SKIP_BRIDGE=1` (page shows "Unknown" for everything because no traffic flows; that's correct)
- [ ] **Merge**

---

## Closing notes

After this plan, when you bring the G5000 to the boat and your H5000 is steering, `/autopilot` shows the current mode, target heading, commanded rudder, and heading error live. Whatever the H5000 broadcasts via the standard PGN 127237 will populate; anything that comes only via Simrad-proprietary PGNs will show "Unknown" until Plan 10 lands those mappers.

Plan 10 candidate: helm dashboard — `/helm` page combining wind/boat/performance numbers in a big-number layout suitable for a tablet at the wheel.
