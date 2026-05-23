# Sensors panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/sources` with a new `/sensors` page that groups channels by physical sensor (Heading, BSP, Apparent wind, GPS, Depth, Motion, Battery), shows live readings with a freshness dot, lists downstream consumers, links to cal pages, and embeds the existing source-priority editor inline (collapsed by default).

**Architecture:** Static `SENSOR_DEFS` array drives the page's seven cards. Each card consumes its slice of the existing observed-sources poll and the existing priority-rules config. A `<SourcePriorityEditor>` component is extracted from today's `/sources/page.tsx` so both the new page (initially) and any later page can host it.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript strict (`noUncheckedIndexedAccess`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-21-sensors-panel-design.md`

---

## File Structure

| File                                                      | Purpose                                                                                                                                                                                 | Status   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `packages/web/src/app/sensors/freshness.ts`               | Pure `freshnessOf(ageMs)` helper returning `'green' \| 'yellow' \| 'red'` plus the threshold constants.                                                                                 | new      |
| `packages/web/src/app/sensors/freshness.test.ts`          | Vitest covering the three branches and the `null` ageMs case.                                                                                                                           | new      |
| `packages/web/src/app/sensors/sensor-definitions.ts`      | Exports `SENSOR_DEFS: SensorDef[]` + the `SensorDef` interface. Static data only.                                                                                                       | new      |
| `packages/web/src/app/sensors/sensor-definitions.test.ts` | Vitest: every listed channel exists in `Channels` constants from `@g5000/core`; sensor ids are unique.                                                                                  | new      |
| `packages/web/src/app/sensors/SourcePriorityEditor.tsx`   | The rule-editor portion of today's `/sources/page.tsx`, extracted as a standalone component scoped to a subset of channels. Stateless w.r.t. the API: parent owns `rules` and `onSave`. | new      |
| `packages/web/src/app/sensors/SensorCard.tsx`             | One card: header + freshness dot + live values + source line + used-by list + ops links + `<details>`-collapsed editor.                                                                 | new      |
| `packages/web/src/app/sensors/page.tsx`                   | Page shell: polls `/api/sources/observed` and `/api/devices`, loads `/api/sources/config`, renders one `<SensorCard>` per `SENSOR_DEFS` entry.                                          | new      |
| `packages/web/src/app/sources/page.tsx`                   | Delete after `/sensors` is verified.                                                                                                                                                    | deleted  |
| `packages/web/src/app/Navbar.tsx`                         | One-line update: `{ href: '/sources', label: 'Sources' }` → `{ href: '/sensors', label: 'Sensors' }`.                                                                                   | modified |

No backend changes. The page reuses the existing `/api/sources/observed`, `/api/sources/config`, and `/api/devices` endpoints unchanged.

---

## Task 1: Freshness helper + tests

**Files:**

- Create: `packages/web/src/app/sensors/freshness.ts`
- Create: `packages/web/src/app/sensors/freshness.test.ts`

Pure function for the green/yellow/red status dot. Two thresholds (2 s, 10 s); null ageMs (no sample ever) is red.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/sensors/freshness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshnessOf, FRESH_THRESHOLD_MS, STALE_THRESHOLD_MS } from './freshness';

describe('freshnessOf', () => {
  it('returns red when ageMs is null (no sample observed)', () => {
    expect(freshnessOf(null)).toBe('red');
  });
  it('returns green below the fresh threshold', () => {
    expect(freshnessOf(0)).toBe('green');
    expect(freshnessOf(FRESH_THRESHOLD_MS - 1)).toBe('green');
  });
  it('returns yellow between fresh and stale thresholds', () => {
    expect(freshnessOf(FRESH_THRESHOLD_MS)).toBe('yellow');
    expect(freshnessOf(STALE_THRESHOLD_MS - 1)).toBe('yellow');
  });
  it('returns red at or above the stale threshold', () => {
    expect(freshnessOf(STALE_THRESHOLD_MS)).toBe('red');
    expect(freshnessOf(60_000)).toBe('red');
  });
  it('thresholds are 2 s and 10 s', () => {
    expect(FRESH_THRESHOLD_MS).toBe(2_000);
    expect(STALE_THRESHOLD_MS).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run packages/web/src/app/sensors/freshness.test.ts
```

Expected: fail with `Cannot find module './freshness'`.

- [ ] **Step 3: Implement**

Create `packages/web/src/app/sensors/freshness.ts`:

```ts
export type Freshness = 'green' | 'yellow' | 'red';

export const FRESH_THRESHOLD_MS = 2_000;
export const STALE_THRESHOLD_MS = 10_000;

/**
 * Classify a sensor reading's freshness for the status dot.
 *
 * `ageMs` is the number of milliseconds since the most recent sample on any of
 * the sensor's channels, or `null` if no sample has ever been observed.
 */
export function freshnessOf(ageMs: number | null): Freshness {
  if (ageMs === null) return 'red';
  if (ageMs < FRESH_THRESHOLD_MS) return 'green';
  if (ageMs < STALE_THRESHOLD_MS) return 'yellow';
  return 'red';
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run packages/web/src/app/sensors/freshness.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean. If stale-dist errors mention `@g5000/db` or `@g5000/core`:

```bash
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/routing packages/coastline
```

then re-typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/sensors/freshness.ts packages/web/src/app/sensors/freshness.test.ts
git commit -m "feat(web): sensors panel — freshness helper

Pure classifier returning 'green' | 'yellow' | 'red' from an age in
milliseconds (or null for no-sample-yet). Thresholds 2 s and 10 s,
shared by every sensor card in v1 — per-sensor thresholds can come
later if a slow-cadence sensor reads yellow during normal operation."
```

---

## Task 2: Sensor definitions + tests

**Files:**

- Create: `packages/web/src/app/sensors/sensor-definitions.ts`
- Create: `packages/web/src/app/sensors/sensor-definitions.test.ts`

Static data driving the seven sensor cards. Tests verify every listed channel actually exists in `@g5000/core`'s `Channels` constants — catches typos when channel names get refactored — and that sensor ids are unique.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/sensors/sensor-definitions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Channels } from '@g5000/core';
import { SENSOR_DEFS } from './sensor-definitions';

function flatChannelValues(node: unknown, acc: string[]): string[] {
  if (typeof node === 'string') {
    acc.push(node);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) flatChannelValues(v, acc);
  }
  return acc;
}

const ALL_KNOWN_CHANNELS = new Set(flatChannelValues(Channels, []));

describe('SENSOR_DEFS', () => {
  it('lists exactly the seven v1 sensors in order', () => {
    expect(SENSOR_DEFS.map((s) => s.id)).toEqual([
      'heading',
      'bsp',
      'apparent-wind',
      'gps',
      'depth',
      'motion',
      'battery',
    ]);
  });

  it('every channel maps to a known constant in @g5000/core Channels', () => {
    for (const def of SENSOR_DEFS) {
      for (const ch of def.channels) {
        expect(ALL_KNOWN_CHANNELS.has(ch), `${def.id}: channel "${ch}"`).toBe(true);
      }
    }
  });

  it('sensor ids are unique', () => {
    const ids = SENSOR_DEFS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every sensor has at least one channel', () => {
    for (const def of SENSOR_DEFS) {
      expect(def.channels.length, def.id).toBeGreaterThan(0);
    }
  });

  it('motion card has no usedBy entries (display-only)', () => {
    const motion = SENSOR_DEFS.find((s) => s.id === 'motion');
    expect(motion).toBeDefined();
    expect(motion!.usedBy).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run packages/web/src/app/sensors/sensor-definitions.test.ts
```

Expected: fail with `Cannot find module './sensor-definitions'`.

- [ ] **Step 3: Implement**

Create `packages/web/src/app/sensors/sensor-definitions.ts`:

```ts
import { Channels } from '@g5000/core';

export type SensorId = 'heading' | 'bsp' | 'apparent-wind' | 'gps' | 'depth' | 'motion' | 'battery';

export interface SensorDef {
  /** Stable id, used as React key and for persisted card-open state. */
  id: SensorId;
  /** Card header label. */
  label: string;
  /** Channels belonging to this sensor, in display order. The first is the
   * "primary" reading and gets prominent type in the card. */
  channels: string[];
  /** Optional link to the cal page for this sensor. Omitted when no page exists. */
  calPage?: { label: string; href: string };
  /** Static list of downstream pipelines that consume this sensor's readings.
   * Empty list ⇒ display-only sensor (currently: motion). */
  usedBy: string[];
}

/**
 * The seven v1 sensor cards on /sensors, in render order.
 *
 * "Directly used by" entries are hand-maintained — pipelines change slowly
 * enough that this is cheaper than runtime graph introspection. Update this
 * table when a new pipeline starts consuming a sensor's reading.
 */
export const SENSOR_DEFS: SensorDef[] = [
  {
    id: 'heading',
    label: 'Heading',
    channels: [Channels.Boat.HeadingMagnetic, Channels.Boat.HeadingTrue, Channels.Nav.MagVar],
    calPage: { label: 'Damping / heading offset', href: '/damping' },
    usedBy: ['True wind', 'Layline angles', 'COG–HDG comparison', 'Polar %', 'AIS bearing display'],
  },
  {
    id: 'bsp',
    label: 'Speed through water (BSP)',
    channels: [Channels.Boat.SpeedWater],
    calPage: { label: 'Damping / BSP cal', href: '/damping' },
    usedBy: ['True wind', 'VMG', 'Polar %', 'Current estimate', 'Sail-timeline ETA'],
  },
  {
    id: 'apparent-wind',
    label: 'Apparent wind',
    channels: [Channels.Wind.ApparentAngle, Channels.Wind.ApparentSpeed],
    calPage: { label: 'Damping / AWS-AWA', href: '/damping' },
    usedBy: [
      'True wind',
      'Polars and targets',
      'Race wind-shift detector',
      'Sail crossover',
      'VMC',
    ],
  },
  {
    id: 'gps',
    label: 'GPS',
    channels: [Channels.Nav.Position, Channels.Nav.Cog, Channels.Nav.CogMagnetic, Channels.Nav.Sog],
    usedBy: [
      'SOG',
      'COG',
      'VMC',
      'Distance / ETA',
      'Route plan',
      'AIS CPA',
      'Anchor watch',
      'Live boat marker',
      'Track recorder',
      'Start-line geometry',
    ],
  },
  {
    id: 'depth',
    label: 'Depth',
    channels: [Channels.Nav.Depth],
    usedBy: ['Anchor watch', 'Shallow alarm'],
  },
  {
    id: 'motion',
    label: 'Motion (IMU)',
    channels: [
      Channels.Motion.Heel,
      Channels.Motion.Pitch,
      Channels.Motion.Yaw,
      Channels.Motion.RateOfTurn,
    ],
    usedBy: [],
  },
  {
    id: 'battery',
    label: 'Battery',
    channels: [Channels.Electrical.BatteryVoltage],
    usedBy: ['Low-battery alarm (when configured)'],
  },
];
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run packages/web/src/app/sensors/sensor-definitions.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/sensors/sensor-definitions.ts packages/web/src/app/sensors/sensor-definitions.test.ts
git commit -m "feat(web): sensors panel — SENSOR_DEFS static config

Seven cards in render order (Heading, BSP, Apparent wind, GPS,
Depth, Motion, Battery), each declaring its channels, optional
cal-page link, and the static 'Directly used by' list. Tests
assert every listed channel exists in @g5000/core Channels and
sensor ids are unique."
```

---

## Task 3: Extract SourcePriorityEditor component

**Files:**

- Create: `packages/web/src/app/sensors/SourcePriorityEditor.tsx`
- Reference (do NOT modify yet): `packages/web/src/app/sources/page.tsx`

The current `/sources/page.tsx` is 794 lines containing both an "observed sources" section and a "priority rules" editor. We extract the priority-rules editor into a standalone component scoped to a subset of channels. The page (`/sensors` in Task 5) owns the rule config state and the persistence; the editor is presentational + edit-callback.

The component's prop contract:

```ts
interface SourcePriorityEditorProps {
  /** Channels this editor manages. Rules whose channelPattern matches one of
   * these channels are visible/editable; other rules are passed through
   * untouched on save. */
  channels: string[];
  /** Full priority-rules config from /api/sources/config. */
  rules: SourcePriorityRule[];
  /** Live observed entries, used to populate the "available sources"
   * dropdown for each rule. */
  observed: ObservedEntry[];
  /** Called with the next full rules array when the user saves an edit.
   * The component does not persist by itself. */
  onSave: (next: SourcePriorityRule[]) => Promise<void>;
  /** True while a save is in flight. The component disables interactions. */
  saving: boolean;
}
```

Behaviour to preserve from today's `/sources/page.tsx`:

- Per-channel rule editing: ordered source list with up/down/delete; "add a source" picker drawing from `observed`; freshness-window slider (`MIN_FRESHNESS` = 0.5 s, `MAX_FRESHNESS` = 30 s).
- "Block" list per rule (the `blocked?: string[]` field).
- Showing the channels this editor owns even when no rule exists yet (offer a "create rule" button).

- [ ] **Step 1: Read the existing /sources/page.tsx top-to-bottom**

Run:

```bash
sed -n '1,200p' packages/web/src/app/sources/page.tsx
```

then

```bash
sed -n '201,400p' packages/web/src/app/sources/page.tsx
```

through to line 794. Identify:

- Type definitions (lines 23–50 in the current file).
- Constants (lines 52–54).
- State management for `rules` / `draft` / `busy` / `err` / `savedFlash`.
- The `saveConfig` handler.
- The per-rule editing JSX (sources list, freshness slider, blocked list).
- The "create rule" affordance.

You will be replicating the rule-editor parts inside `SourcePriorityEditor.tsx`. The "observed sources" overview at the top of the existing page does NOT move into the editor — it goes into `SensorCard` (Task 4) as the live-value section.

- [ ] **Step 2: Create the file with shared types and the component skeleton**

Create `packages/web/src/app/sensors/SourcePriorityEditor.tsx`. Use the EXACT type definitions from the existing `/sources/page.tsx`:

```tsx
'use client';
import { useState } from 'react';

export interface SourcePriorityRule {
  channelPattern: string;
  sources: string[];
  freshnessSeconds: number;
  blocked?: string[];
}

export interface ObservedEntry {
  channel: string;
  source: string;
  lastSeenMs: number;
  ageMs: number;
  lastValue: unknown;
}

const MIN_FRESHNESS = 0.5;
const MAX_FRESHNESS = 30;

interface SourcePriorityEditorProps {
  channels: string[];
  rules: SourcePriorityRule[];
  observed: ObservedEntry[];
  onSave: (next: SourcePriorityRule[]) => Promise<void>;
  saving: boolean;
}

/**
 * Per-channel source-priority editor, scoped to a subset of channels (a
 * sensor's channels). The parent (/sensors/page.tsx) owns the full rule
 * config and the persistence call; this component just renders the
 * channels we manage and calls back with the next full rules array on
 * each save.
 *
 * Rules whose channelPattern does not match any of our `channels` are
 * passed through unchanged in the save callback.
 */
export function SourcePriorityEditor({
  channels,
  rules,
  observed,
  onSave,
  saving,
}: SourcePriorityEditorProps) {
  const ownedRuleIdx = (channel: string): number =>
    rules.findIndex((r) => r.channelPattern === channel);

  const knownSourcesForChannel = (channel: string): string[] => {
    const set = new Set<string>();
    for (const e of observed) if (e.channel === channel) set.add(e.source);
    return Array.from(set).sort();
  };

  const save = async (
    mutator: (rules: SourcePriorityRule[]) => SourcePriorityRule[],
  ): Promise<void> => {
    const next = mutator(rules);
    await onSave(next);
  };

  return (
    <div className="space-y-3">
      {channels.map((channel) => (
        <ChannelRuleRow
          key={channel}
          channel={channel}
          ruleIdx={ownedRuleIdx(channel)}
          rule={ownedRuleIdx(channel) >= 0 ? rules[ownedRuleIdx(channel)] : null}
          knownSources={knownSourcesForChannel(channel)}
          saving={saving}
          onCreate={() =>
            save((r) => [...r, { channelPattern: channel, sources: [], freshnessSeconds: 5 }])
          }
          onUpdate={(next) =>
            save((r) => {
              const idx = r.findIndex((x) => x.channelPattern === channel);
              if (idx < 0) return r;
              const copy = [...r];
              copy[idx] = next;
              return copy;
            })
          }
          onDelete={() => save((r) => r.filter((x) => x.channelPattern !== channel))}
        />
      ))}
    </div>
  );
}

interface ChannelRuleRowProps {
  channel: string;
  ruleIdx: number;
  rule: SourcePriorityRule | null;
  knownSources: string[];
  saving: boolean;
  onCreate: () => void;
  onUpdate: (next: SourcePriorityRule) => void;
  onDelete: () => void;
}

function ChannelRuleRow({
  channel,
  rule,
  knownSources,
  saving,
  onCreate,
  onUpdate,
  onDelete,
}: ChannelRuleRowProps) {
  const [pickerSource, setPickerSource] = useState('');

  if (rule === null) {
    return (
      <div className="text-sm text-slate-400 flex items-center justify-between gap-2 border border-slate-800 rounded p-2">
        <span className="font-mono">{channel}</span>
        <button
          type="button"
          onClick={onCreate}
          disabled={saving}
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs rounded disabled:opacity-40"
        >
          + add rule
        </button>
      </div>
    );
  }

  const moveSource = (from: number, to: number): void => {
    if (to < 0 || to >= rule.sources.length) return;
    const next = [...rule.sources];
    const [taken] = next.splice(from, 1);
    if (taken === undefined) return;
    next.splice(to, 0, taken);
    onUpdate({ ...rule, sources: next });
  };

  const removeSource = (idx: number): void => {
    onUpdate({ ...rule, sources: rule.sources.filter((_, i) => i !== idx) });
  };

  const addPickedSource = (): void => {
    if (!pickerSource || rule.sources.includes(pickerSource)) return;
    onUpdate({ ...rule, sources: [...rule.sources, pickerSource] });
    setPickerSource('');
  };

  const setFreshness = (s: number): void => {
    onUpdate({ ...rule, freshnessSeconds: s });
  };

  const availableForPicker = knownSources.filter((s) => !rule.sources.includes(s));

  return (
    <div className="border border-slate-700 rounded p-2 space-y-2 bg-slate-900/50">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-slate-200">{channel}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40"
        >
          delete rule
        </button>
      </div>

      {rule.sources.length === 0 && (
        <div className="text-xs text-slate-500">No sources yet — add one below.</div>
      )}
      {rule.sources.map((src, idx) => (
        <div key={src} className="flex items-center gap-1 text-sm">
          <span className="text-slate-500 text-xs w-4">{idx + 1}.</span>
          <span className="font-mono text-slate-200 flex-1">{src}</span>
          <button
            type="button"
            onClick={() => moveSource(idx, idx - 1)}
            disabled={saving || idx === 0}
            className="px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            aria-label="move up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => moveSource(idx, idx + 1)}
            disabled={saving || idx === rule.sources.length - 1}
            className="px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            aria-label="move down"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={() => removeSource(idx)}
            disabled={saving}
            className="px-1 text-rose-400 hover:text-rose-300 disabled:opacity-40"
            aria-label="remove"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 text-sm">
        <select
          value={pickerSource}
          onChange={(e) => setPickerSource(e.target.value)}
          disabled={saving || availableForPicker.length === 0}
          className="bg-slate-800 border border-slate-700 text-slate-200 px-2 py-1 rounded text-xs disabled:opacity-40"
        >
          <option value="">
            {availableForPicker.length === 0 ? '(no other observed sources)' : 'select a source…'}
          </option>
          {availableForPicker.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addPickedSource}
          disabled={saving || !pickerSource}
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs rounded disabled:opacity-40"
        >
          + add
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>freshness window:</span>
        <input
          type="range"
          min={MIN_FRESHNESS}
          max={MAX_FRESHNESS}
          step={0.5}
          value={rule.freshnessSeconds}
          onChange={(e) => setFreshness(Number(e.target.value))}
          disabled={saving}
          className="flex-1"
        />
        <span className="font-mono text-slate-200 w-12 text-right">
          {rule.freshnessSeconds.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sensors/SourcePriorityEditor.tsx
git commit -m "feat(web): SourcePriorityEditor — extract from /sources/page.tsx

Stateless rule editor scoped to a subset of channels (a sensor's
channels). Parent owns the full rule config and the persistence
call; this component renders the channels we manage and calls back
with the next full rules array on each save. Behaviour preserves
the source ordering / freshness-slider / add-remove-block UX from
today's /sources page; the next task wires it into SensorCard."
```

---

## Task 4: SensorCard component

**Files:**

- Create: `packages/web/src/app/sensors/SensorCard.tsx`

One card. Header + freshness dot + live values + source line + "Directly used by" + Ops links + the collapsed-by-default priority editor.

- [ ] **Step 1: Create the file**

Create `packages/web/src/app/sensors/SensorCard.tsx`:

```tsx
'use client';
import { friendlySourceLabel, formatChannelValue } from '../../lib/friendly-source';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import {
  SourcePriorityEditor,
  type ObservedEntry,
  type SourcePriorityRule,
} from './SourcePriorityEditor';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full priority-rules config (the editor filters to its own channels). */
  rules: SourcePriorityRule[];
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
}

const DOT_COLOR: Record<Freshness, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
};

/**
 * One sensor's card on /sensors. Reads observed entries + rules from props
 * and slices to its own channels. The freshness dot tracks the most-recent
 * sample across this sensor's channels.
 */
export function SensorCard({ def, observed, rules, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);

  // Pick the freshest entry per channel for the live-value display.
  const latestByChannel = new Map<string, ObservedEntry>();
  for (const e of own) {
    const prev = latestByChannel.get(e.channel);
    if (!prev || e.ageMs < prev.ageMs) latestByChannel.set(e.channel, e);
  }

  // Group source labels for the source line (one per unique source).
  const sources = Array.from(new Set(own.map((e) => e.source))).sort();

  return (
    <section className="border border-slate-800 rounded bg-slate-900/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block w-2 h-2 rounded-full ${DOT_COLOR[dot]}`}
          />
          {def.label}
        </h2>
      </header>

      <div className="space-y-1">
        {def.channels.map((ch, i) => {
          const e = latestByChannel.get(ch);
          const value = e ? formatChannelValue(ch, e.lastValue) : '—';
          return (
            <div
              key={ch}
              className={
                'flex items-baseline justify-between gap-3 ' +
                (i === 0 ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
              }
            >
              <span className="font-mono text-xs text-slate-500">{ch}</span>
              <span className="tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-slate-400">
        {sources.length === 0 ? (
          <span>No source observed.</span>
        ) : (
          <>
            <span className="text-slate-500">Source: </span>
            {sources.map((s) => friendlySourceLabel(s)).join(', ')}
            {own.length > 0 && (
              <>
                <span className="text-slate-500"> · last update </span>
                {(Math.min(...own.map((e) => e.ageMs)) / 1000).toFixed(1)} s ago
              </>
            )}
          </>
        )}
      </div>

      {def.usedBy.length > 0 && (
        <div className="text-xs">
          <div className="text-slate-500 mb-1">Directly used by:</div>
          <ul className="text-slate-300 list-disc list-inside space-y-0.5">
            {def.usedBy.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {def.calPage && (
        <div>
          <a
            href={def.calPage.href}
            className="inline-block text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded"
          >
            {def.calPage.label} →
          </a>
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none">
          Source priorities ({def.channels.length} channel{def.channels.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2">
          <SourcePriorityEditor
            channels={def.channels}
            rules={rules}
            observed={observed}
            saving={saving}
            onSave={onSaveRules}
          />
        </div>
      </details>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sensors/SensorCard.tsx
git commit -m "feat(web): SensorCard — one sensor's card on /sensors

Header + freshness dot + live values + source line + 'Directly used
by' list + cal-page link + a collapsed-by-default SourcePriority-
Editor scoped to this sensor's channels. Picks the freshest observed
entry per channel for the live display, computes the dot from the
minimum age across all of the sensor's channels."
```

---

## Task 5: /sensors page + delete /sources

**Files:**

- Create: `packages/web/src/app/sensors/page.tsx`
- Delete: `packages/web/src/app/sources/page.tsx`

The page polls the existing endpoints and renders one `<SensorCard>` per `SENSOR_DEFS` entry.

- [ ] **Step 1: Create the page**

Create `packages/web/src/app/sensors/page.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { SENSOR_DEFS } from './sensor-definitions';
import { SensorCard } from './SensorCard';
import type { ObservedEntry, SourcePriorityRule } from './SourcePriorityEditor';

interface ObservedResponse {
  entries: ObservedEntry[];
  windowMs: number;
}

const POLL_MS = 1000;

export default function SensorsPage() {
  const [observed, setObserved] = useState<ObservedEntry[]>([]);
  const [observedErr, setObservedErr] = useState<string | null>(null);
  const [rules, setRules] = useState<SourcePriorityRule[]>([]);
  const [rulesErr, setRulesErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Poll observed sources.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/sources/observed', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET observed: ${res.status}`);
        const body = (await res.json()) as ObservedResponse;
        if (!alive) return;
        setObserved(body.entries);
        setObservedErr(null);
      } catch (e) {
        if (alive) setObservedErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Load priority rules once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/sources/config', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET config: ${res.status}`);
        const body = (await res.json()) as SourcePriorityRule[];
        if (alive) setRules(body);
      } catch (e) {
        if (alive) setRulesErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSaveRules = useCallback(async (next: SourcePriorityRule[]): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch('/api/sources/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`PUT config: ${res.status}`);
      setRules(next);
      setRulesErr(null);
    } catch (e) {
      setRulesErr(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Sensors</h1>
        <p className="text-sm text-slate-400 mt-1">
          Live readings for connected sensors. Expand a card&apos;s &ldquo;Source priorities&rdquo;
          section to edit which sources feed which channels.
        </p>
      </header>

      {observedErr && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded p-2">
          Could not load live data: {observedErr}
        </div>
      )}
      {rulesErr && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded p-2">
          Could not load source priorities: {rulesErr}
        </div>
      )}

      {SENSOR_DEFS.map((def) => (
        <SensorCard
          key={def.id}
          def={def}
          observed={observed}
          rules={rules}
          saving={saving}
          onSaveRules={onSaveRules}
        />
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Delete the old /sources page**

```bash
git rm packages/web/src/app/sources/page.tsx
```

Verify with `ls packages/web/src/app/sources/` — should be empty or non-existent.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean. If `Navbar.tsx` references `/sources`, typecheck will still pass (the href is just a string), but Next.js will fail to navigate to it. Task 6 fixes the Navbar.

- [ ] **Step 4: Smoke the page locally (manual, optional)**

If you want a quick sanity check before Task 6, you can hit the page directly:

```bash
npm run dev --workspace @g5000/autopilot-server  # in another shell
curl -sSI http://localhost:3000/sensors | head -2
```

Expected: `HTTP/1.1 200 OK`. Skip if you'd rather do the full smoke in Task 7.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/sensors/page.tsx packages/web/src/app/sources/page.tsx
git commit -m "feat(web): /sensors page — replace /sources

New /sensors page polls /api/sources/observed and /api/sources/config
(same endpoints /sources used today) and renders one SensorCard per
SENSOR_DEFS entry. Old /sources/page.tsx deleted — its functionality
is fully absorbed into the per-sensor cards. Cal pages and /devices
are untouched."
```

---

## Task 6: Update Navbar

**Files:**

- Modify: `packages/web/src/app/Navbar.tsx`

One-line change: the link from "Sources" → "Sensors" at the new path.

- [ ] **Step 1: Locate the existing link**

```bash
grep -n "/sources\|Sources" packages/web/src/app/Navbar.tsx
```

Expected: one match around line 46 of the form `{ href: '/sources', label: 'Sources' }`.

- [ ] **Step 2: Edit the link**

Replace the single line:

```ts
      { href: '/sources', label: 'Sources' },
```

with:

```ts
      { href: '/sensors', label: 'Sensors' },
```

No other changes to `Navbar.tsx`.

- [ ] **Step 3: Verify with grep**

```bash
grep -n "/sources\|Sources" packages/web/src/app/Navbar.tsx
```

Expected: no matches.

- [ ] **Step 4: Typecheck + lint + full tests**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

```bash
npm test
```

Expected: ~696 passing (10 new tests added in Task 1+2 on top of the existing baseline). Pre-existing environmental failures (wgrib2, ConfigStore-not-booted, coastline data) acceptable — same as documented in CLAUDE.md's "Known environmental failures".

```bash
npm run lint
```

Expected: clean for files touched in this branch.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/Navbar.tsx
git commit -m "feat(web): navbar link Sources → Sensors

Points the navbar entry that used to land on /sources at the new
/sensors page."
```

---

## Task 7: Manual verification

**Files:**

- Modify: none.

End-to-end smoke on the local dev server.

- [ ] **Step 1: Free port 3000 and start the dev server**

```bash
lsof -ti :3000 2>/dev/null | xargs -r kill -9
cd /Users/gregjohnson/code/g5000/.worktrees/sensors-panel
npm run dev --workspace @g5000/autopilot-server
```

Wait for `[autopilot] web UI on http://0.0.0.0:3000` in the log.

- [ ] **Step 2: Load /sensors**

Open `http://localhost:3000/sensors`. Verify the seven cards render in order:
Heading, Speed through water (BSP), Apparent wind, GPS, Depth, Motion (IMU), Battery.

If the boat is providing data via YDWG/NGT-1, expect green dots on Heading, BSP, Apparent wind, GPS, Depth (Battery and Motion may be red if no source publishes those channels — that's correct, not a bug).

- [ ] **Step 3: Navbar**

Verify the navbar shows "Sensors" (not "Sources"). Click it from another page (e.g. `/helm`) and confirm it lands on `/sensors`.

Visit `http://localhost:3000/sources` directly — expected: Next.js 404 page (since the route is deleted).

- [ ] **Step 4: Card content**

For at least the Heading card:

- Live values rendered for `boat.heading.magnetic`, `boat.heading.true`, `nav.magvar` (any with no source show "—").
- Source line shows a friendly source label and "last update X.X s ago".
- "Directly used by" lists five items.
- "Damping / heading offset →" button is present.
- Click it; confirm it navigates to `/damping`.

- [ ] **Step 5: Source priorities editor**

Expand the "Source priorities" disclosure on any card with at least one channel that has an existing rule.

- Confirm the rule editor renders, with the same source-ordering / freshness-slider / add-remove controls as the old `/sources` page.
- Move a source up or down in the priority list. Verify the change persists on page reload.
- Revert your change so production behaviour is unchanged. Reload again to confirm.

- [ ] **Step 6: Freshness transition**

Pick a card whose sensor you can disconnect (or wait for a quiet channel). Confirm the dot transitions green → yellow → red as the most-recent sample ages past 2 s, then 10 s.

- [ ] **Step 7: Other pages still work**

Quick smoke-check that nothing else broke:

- `/chart` loads, basemap renders, NOAA toggle visible.
- `/helm` tiles render.
- `/race` panel renders.
- `/sails` and `/sails/crossover` render.
- `/autopilot` renders.
- `/damping` renders.
- `/devices` renders.

- [ ] **Step 8: Done — no further commit required**

The work is shippable from Task 6's commit. Stop here unless verification surfaced a bug.

---

## Self-review

**Spec coverage:**

- New `/sensors` page with seven cards → Task 5 (page) + Task 2 (defs) + Task 4 (card) ✓
- Motion card display-only (no `usedBy`) → Task 2 includes the test ✓
- Replace `/sources` (delete) → Task 5 ✓
- `/devices` and cal pages untouched → no task modifies them ✓
- Status dot thresholds 2 s / 10 s → Task 1 ✓
- Source line uses `friendlySourceLabel` → Task 4 ✓
- "Directly used by" static, hand-maintained → Task 2 (SENSOR_DEFS) ✓
- Ops links to cal pages → Task 4 (rendered) + Task 2 (declared) ✓
- Source priorities embedded, collapsed by default → Task 4 (`<details>`) + Task 3 (component) ✓
- No backend changes → Tasks 5/3 use existing `/api/sources/observed`, `/api/sources/config`, `/api/devices` ✓
- Navbar rename → Task 6 ✓
- Manual verification list from spec → Task 7 ✓

**Placeholder scan:** none — every step has either complete code, an exact command + expected output, or a precise diff instruction.

**Type consistency:**

- `SensorDef` shape in Task 2 matches what `SensorCard` consumes in Task 4 (id, label, channels, calPage?, usedBy).
- `SourcePriorityRule`, `ObservedEntry` shapes match what's in the existing `/sources/page.tsx` byte-for-byte (verified by reading lines 23–50 of that file in Task 3 Step 1).
- `SourcePriorityEditorProps` (Task 3) matches the props `SensorCard` passes (Task 4) — `channels`, `rules`, `observed`, `saving`, `onSave`.
- Page state types in Task 5 (`SourcePriorityRule[]`, `ObservedEntry[]`) are imported from `SourcePriorityEditor.tsx` so there's one definition per shape.
