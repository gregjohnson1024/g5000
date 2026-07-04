# Sensors single-source pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/sensors` priority editor with an inline per-channel radio group — `Auto` plus one radio per source — that pins the whole app to a single chosen source (no failover).

**Architecture:** Web-only. A "pin" is a one-entry `SourcePriorityRule` (`sources:[X]`), which the existing selector already treats as "use only this source, never fail over" — so the selector, config-store, schema, and `/api/config/source-priority` are untouched. A new pure helper reads/writes the rule; `SensorCard` renders the radios; the old `SourcePriorityEditor` is deleted and its shared types relocated.

**Tech Stack:** Next.js 16 / React 19, TypeScript composite (`tsc -b`), Vitest (node env; pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-06-16-sensors-single-source-pin.md`

**Branch:** all work on `feature/sensors-single-source-pin` (from `develop`).

**Context — current state (verified):**

- `@g5000/core` exports `interface SourcePriorityRule { channelPattern: string; sources: string[]; freshnessSeconds: number; blocked?: string[] }` (via `export * from './selector.js'`).
- `packages/web/src/app/sensors/SourcePriorityEditor.tsx` currently _also_ declares a duplicate local `SourcePriorityRule` and an `ObservedEntry` interface, and exports the `SourcePriorityEditor` component. It has **no test file**.
- Importers of `./SourcePriorityEditor`: `group-sources.ts` + `group-sources.test.ts` (type `ObservedEntry`), `page.tsx` (types `ObservedEntry`, `SourcePriorityRule`), `SensorCard.tsx` (the component + both types).
- `SensorCard` already receives `rules`, `onSaveRules`, `observed`, `devices` props.
- `deviceLabel(source, devices)`, `groupSourcesByChannel(own)`, `formatChannelValue(v)`, `freshnessOf(ageMs)` exist and are reused unchanged.

---

### Task 1: `source-pin.ts` pure helper

**Files:**

- Create: `packages/web/src/lib/source-pin.ts`
- Test: `packages/web/src/lib/source-pin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/source-pin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pinnedSourceForChannel, setPinnedSource, PIN_FRESHNESS_SECONDS } from './source-pin';
import type { SourcePriorityRule } from '@g5000/core';

const rule = (channelPattern: string, sources: string[]): SourcePriorityRule => ({
  channelPattern,
  sources,
  freshnessSeconds: 5,
});

describe('pinnedSourceForChannel', () => {
  it('returns null (Auto) when no rule matches the channel', () => {
    expect(pinnedSourceForChannel([], 'boat.heading.magnetic')).toBeNull();
  });

  it('returns the single source of a one-entry rule', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80'])];
    expect(pinnedSourceForChannel(rules, 'boat.heading.magnetic')).toBe('n2k:127250@0x80');
  });

  it('reads a legacy multi-source rule as pinned-to-first', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80', 'n2k:127250@0x11'])];
    expect(pinnedSourceForChannel(rules, 'boat.heading.magnetic')).toBe('n2k:127250@0x80');
  });
});

describe('setPinnedSource', () => {
  it('adds a one-entry rule when pinning with no prior rule', () => {
    const next = setPinnedSource([], 'depth', 'n2k:128267@0x20');
    expect(next).toEqual([
      {
        channelPattern: 'depth',
        sources: ['n2k:128267@0x20'],
        freshnessSeconds: PIN_FRESHNESS_SECONDS,
      },
    ]);
  });

  it('replaces an existing rule when switching source', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80', 'n2k:127250@0x11'])];
    const next = setPinnedSource(rules, 'boat.heading.magnetic', 'n2k:127250@0x11');
    expect(next).toEqual([
      {
        channelPattern: 'boat.heading.magnetic',
        sources: ['n2k:127250@0x11'],
        freshnessSeconds: PIN_FRESHNESS_SECONDS,
      },
    ]);
  });

  it('removes the channel rule when setting Auto (null)', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80'])];
    expect(setPinnedSource(rules, 'boat.heading.magnetic', null)).toEqual([]);
  });

  it('leaves other channels rules untouched', () => {
    const rules = [
      rule('depth', ['n2k:128267@0x20']),
      rule('boat.heading.magnetic', ['n2k:127250@0x80']),
    ];
    const next = setPinnedSource(rules, 'boat.heading.magnetic', null);
    expect(next).toEqual([rule('depth', ['n2k:128267@0x20'])]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/source-pin.test.ts`
Expected: FAIL — cannot resolve `./source-pin`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/source-pin.ts`:

```ts
import type { SourcePriorityRule } from '@g5000/core';

/**
 * Freshness window stored on a pin rule. Irrelevant for a single-source rule
 * (a source always wins its own freshly-arrived sample, and there's no other
 * source to fail over to), but the config API requires a positive finite
 * value, so we store a constant.
 */
export const PIN_FRESHNESS_SECONDS = 5;

/**
 * The source currently pinned for `channel`, or null for Auto (no rule).
 * Reads `sources[0]` of the first rule whose channelPattern equals the
 * channel, so a legacy multi-source rule reads as pinned-to-its-first.
 */
export function pinnedSourceForChannel(
  rules: SourcePriorityRule[],
  channel: string,
): string | null {
  const rule = rules.find((r) => r.channelPattern === channel);
  return rule?.sources[0] ?? null;
}

/**
 * Return a new rules array with `channel` pinned to `source`, or — when
 * `source` is null (Auto) — with any rule for `channel` removed. Replaces an
 * existing rule for the channel; other channels' rules pass through unchanged.
 */
export function setPinnedSource(
  rules: SourcePriorityRule[],
  channel: string,
  source: string | null,
): SourcePriorityRule[] {
  const others = rules.filter((r) => r.channelPattern !== channel);
  if (source === null) return others;
  return [
    ...others,
    { channelPattern: channel, sources: [source], freshnessSeconds: PIN_FRESHNESS_SECONDS },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/source-pin.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/lib/source-pin.ts packages/web/src/lib/source-pin.test.ts
git commit -m "feat(web): source-pin helper (read/write single-source rule)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Relocate `ObservedEntry` to `sensors-types.ts`

**Files:**

- Create: `packages/web/src/app/sensors/sensors-types.ts`
- Modify: `packages/web/src/app/sensors/group-sources.ts`
- Modify: `packages/web/src/app/sensors/group-sources.test.ts`

Moves `ObservedEntry` out of `SourcePriorityEditor.tsx` (which is deleted in Task 4) into a dedicated module, and repoints the two `group-sources` files. `SourcePriorityEditor.tsx` still exists and still exports its own (identical) `ObservedEntry`, so `page.tsx`/`SensorCard.tsx` keep compiling until Tasks 3–4.

- [ ] **Step 1: Create `sensors-types.ts`**

```ts
/**
 * Shared types for the /sensors page, kept separate from any component so the
 * removal of SourcePriorityEditor doesn't take them with it.
 */

/** One (channel, source) observation from `/api/sources/observed`. */
export interface ObservedEntry {
  channel: string;
  source: string;
  lastSeenMs: number;
  ageMs: number;
  lastValue: unknown;
}
```

- [ ] **Step 2: Repoint `group-sources.ts`**

Change its first line from:

```ts
import type { ObservedEntry } from './SourcePriorityEditor';
```

to:

```ts
import type { ObservedEntry } from './sensors-types';
```

- [ ] **Step 3: Repoint `group-sources.test.ts`**

Change the line:

```ts
import type { ObservedEntry } from './SourcePriorityEditor';
```

to:

```ts
import type { ObservedEntry } from './sensors-types';
```

- [ ] **Step 4: Verify build + tests**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b && npx vitest run packages/web/src/app/sensors/group-sources.test.ts`
Expected: `tsc -b` exit 0; group-sources tests pass (3).

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/sensors-types.ts packages/web/src/app/sensors/group-sources.ts packages/web/src/app/sensors/group-sources.test.ts
git commit -m "refactor(web): move ObservedEntry to sensors-types.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Replace the editor with an inline radio group in `SensorCard`

**Files:**

- Modify: `packages/web/src/app/sensors/SensorCard.tsx` (full replacement below)

Renders, per channel, a headline (reflecting the pin) and a radio group: `Auto` plus one row per source. Rows = observed sources for the channel, plus the pinned source if it isn't currently observed (so a pinned-but-stale source stays visible/selectable). Removes the `SourcePriorityEditor` `<details>`. Imports `ObservedEntry` from `./sensors-types`, `SourcePriorityRule` from `@g5000/core`, and the pin helpers.

- [ ] **Step 1: Replace the file**

Overwrite `packages/web/src/app/sensors/SensorCard.tsx` with:

```tsx
'use client';
import type { SourcePriorityRule } from '@g5000/core';
import { formatChannelValue } from '../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../lib/device-label';
import { pinnedSourceForChannel, setPinnedSource } from '../../lib/source-pin';
import { groupSourcesByChannel } from './group-sources';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full source-priority config (the card reads/writes its own channels). */
  rules: SourcePriorityRule[];
  /** N2K device registry keyed by source address, for friendly source names. */
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
}

const DOT_COLOR: Record<Freshness, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
};

/**
 * One sensor's card on /sensors. Per channel: a headline value plus a radio
 * group — `Auto` (most recent) or a single pinned source. Pinning writes a
 * one-entry source-priority rule so the whole app uses only that source (no
 * failover); `Auto` removes the rule. A pinned source that has gone stale
 * stays listed (with `—`) so it remains selectable.
 */
export function SensorCard({
  def,
  observed,
  rules,
  devices,
  saving,
  onSaveRules,
}: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);

  // Freshest entry per channel for the Auto headline.
  const latestByChannel = new Map<string, ObservedEntry>();
  for (const e of own) {
    const prev = latestByChannel.get(e.channel);
    if (!prev || e.ageMs < prev.ageMs) latestByChannel.set(e.channel, e);
  }

  const bySource = groupSourcesByChannel(own);

  const setPin = (channel: string, source: string | null): void => {
    void onSaveRules(setPinnedSource(rules, channel, source));
  };

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

      <div className="space-y-3">
        {def.channels.map((ch, i) => {
          const pinned = pinnedSourceForChannel(rules, ch);
          const observedForCh = bySource.get(ch) ?? [];

          // Rows: every observed source, plus the pinned source if it isn't
          // currently observed (kept visible so it stays selectable).
          const rows: { source: string; entry: ObservedEntry | null }[] = observedForCh.map(
            (e) => ({ source: e.source, entry: e }),
          );
          if (pinned && !observedForCh.some((e) => e.source === pinned)) {
            rows.push({ source: pinned, entry: null });
          }

          // Headline reflects the choice.
          let headlineValue: string;
          if (pinned) {
            const pe = observedForCh.find((e) => e.source === pinned);
            headlineValue = pe ? formatChannelValue(pe.lastValue) : '—';
          } else {
            const fresh = latestByChannel.get(ch);
            headlineValue = fresh ? formatChannelValue(fresh.lastValue) : '—';
          }

          return (
            <div key={ch} className="space-y-1">
              <div
                className={
                  'flex items-baseline justify-between gap-3 ' +
                  (i === 0 ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
                }
              >
                <span className="font-mono text-xs text-slate-500">{ch}</span>
                <span className="tabular-nums">{headlineValue}</span>
              </div>

              <div className="pl-3 space-y-0.5 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-slate-400">
                  <input
                    type="radio"
                    name={`pin-${ch}`}
                    checked={pinned === null}
                    onChange={() => setPin(ch, null)}
                    disabled={saving}
                  />
                  <span>Auto — most recent</span>
                </label>
                {rows.length === 0 ? (
                  <div className="text-slate-500 pl-6">No source observed.</div>
                ) : (
                  rows.map(({ source, entry }) => (
                    <label key={source} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`pin-${ch}`}
                        checked={pinned === source}
                        onChange={() => setPin(ch, source)}
                        disabled={saving}
                      />
                      <span className="truncate flex-1 text-slate-300">
                        {deviceLabel(source, devices)}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        <span className="text-slate-300">
                          {entry ? formatChannelValue(entry.lastValue) : '—'}
                        </span>
                        {entry && (
                          <span className="text-slate-600">
                            {' '}
                            · {(entry.ageMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          );
        })}
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
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles (page.tsx still imports types from SourcePriorityEditor — that's fine until Task 4)**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0 (`SourcePriorityEditor.tsx` still exists and is still imported by `page.tsx` for types).

- [ ] **Step 3: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/SensorCard.tsx
git commit -m "feat(web): inline single-source radio picker on sensor cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Repoint `page.tsx` and delete `SourcePriorityEditor`

**Files:**

- Modify: `packages/web/src/app/sensors/page.tsx`
- Delete: `packages/web/src/app/sensors/SourcePriorityEditor.tsx`

- [ ] **Step 1: Repoint page.tsx type imports**

In `packages/web/src/app/sensors/page.tsx`, replace the line:

```ts
import type { ObservedEntry, SourcePriorityRule } from './SourcePriorityEditor';
```

with these two lines:

```ts
import type { SourcePriorityRule } from '@g5000/core';
import type { ObservedEntry } from './sensors-types';
```

- [ ] **Step 2: Delete the now-unused component**

Run: `cd /Users/gregjohnson/code/g5000 && git rm packages/web/src/app/sensors/SourcePriorityEditor.tsx`
Expected: file staged for deletion. (Confirm nothing else imports it: `grep -rn "SourcePriorityEditor" packages/web/src` should return no matches.)

- [ ] **Step 3: Run the full gates**

```bash
cd /Users/gregjohnson/code/g5000 && npx tsc -b
cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/source-pin.test.ts packages/web/src/lib/device-label.test.ts packages/web/src/app/sensors/group-sources.test.ts
cd /Users/gregjohnson/code/g5000/packages/web && npm run build
```

Expected: `tsc -b` exit 0; tests pass (8 + 8 + 3 = 19); `npm run build` succeeds with `/sensors` in the route manifest.

- [ ] **Step 4: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/page.tsx
git commit -m "refactor(web): drop SourcePriorityEditor; sensors uses single-source pin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks)

1. Open `/sensors`; for `boat.heading.magnetic` (two sources) the card shows `Auto` + `ZG100 Compass (0x80)` + `Precision-9 Compass (0x11)` radios, expanded, right under the value.
2. Pin `0x80` → headline locks to 0x80's value; the rest of the app (helm/mast true-wind) uses only 0x80 (no flap to 0x11).
3. Select `Auto` → reverts to most-recent.
4. Pin a source, then pull its data (or watch a naturally-stale one): the row stays listed with `—`, headline `—`, dot reddens; it does NOT fail over to the other source.
