# Sensors "All channels" view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/sensors` with an always-expanded "All channels" section listing every live channel not in a curated card, grouped Measured/Computed, with friendly labels and the same pin controls.

**Architecture:** Web-only, off the existing `/api/sources/observed` + `/api/devices`. Extract the per-channel render+pin block from `SensorCard` into a reusable `ChannelPanel`; add a pure `channel-label` helper and an `AllChannels` component; wire it under the curated cards in `page.tsx`. No backend/selector/config/API change.

**Tech Stack:** Next.js 16 / React 19, TypeScript composite (`tsc -b`), Vitest (node env; pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-06-16-sensors-all-channels.md`

**Branch:** all work on `feature/sensors-all-channels` (from `develop`).

**Context — current state (verified):**
- `SensorCard.tsx` currently inlines the per-channel block (headline + `Auto`/source radio group) and imports `formatChannelValue`, `deviceLabel`/`DeviceLabelInfo`, `pinnedSourceForChannel`/`setPinnedSource`, `groupSourcesByChannel`, `freshnessOf`/`Freshness`, `SensorDef`, `ObservedEntry`.
- `sensor-definitions.ts` exports `SENSOR_DEFS` (`{ id; label; channels: string[]; usedBy: string[]; calPage?: {...} }[]`).
- Helpers already present and reused: `groupSourcesByChannel(entries) → Map<string, ObservedEntry[]>` (sorted by source), `pinnedSourceForChannel`/`setPinnedSource` (`packages/web/src/lib/source-pin.ts`), `deviceLabel`/`DeviceLabelInfo`, `formatChannelValue`, `freshnessOf`/`Freshness`, `ObservedEntry` (`./sensors-types`), `SourcePriorityRule` (`@g5000/core`).

---

### Task 1: `channel-label.ts` pure helper

**Files:**
- Create: `packages/web/src/lib/channel-label.ts`
- Test: `packages/web/src/lib/channel-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/channel-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { channelLabel, channelKind } from './channel-label';

describe('channelLabel', () => {
  it('prettifies a dotted path', () => {
    expect(channelLabel('boat.rudder.angle')).toBe('Boat rudder angle');
    expect(channelLabel('wind.true.direction')).toBe('Wind true direction');
  });

  it('upper-cases known acronyms', () => {
    expect(channelLabel('nav.gps.cog.magnetic')).toBe('Nav GPS COG magnetic');
    expect(channelLabel('performance.target.vmg')).toBe('Performance target VMG');
  });

  it('splits camelCase segments into words', () => {
    expect(channelLabel('groove.helmSource')).toBe('Groove helm source');
    expect(channelLabel('motion.rateOfTurn')).toBe('Motion rate of turn');
  });

  it('uses an override when present', () => {
    expect(channelLabel('nav.magvar')).toBe('Magnetic variation');
  });
});

describe('channelKind', () => {
  it('is measured when any source is n2k or 0183', () => {
    expect(channelKind(['n2k:127250@0x11'])).toBe('measured');
    expect(channelKind(['0183:port1'])).toBe('measured');
    expect(channelKind(['n2k:130306@0x02', 'computed:true_wind'])).toBe('measured');
  });

  it('is computed when no source is a device', () => {
    expect(channelKind(['computed:true_wind'])).toBe('computed');
    expect(channelKind([])).toBe('computed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/channel-label.test.ts`
Expected: FAIL — cannot resolve `./channel-label`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/channel-label.ts`:

```ts
/** Lower-case tokens to render upper-case in channel labels. */
const ACRONYMS = new Set([
  'gps', 'cog', 'sog', 'vmg', 'twa', 'tws', 'twd', 'awa', 'aws', 'ais', 'imu', 'eta', 'hdg',
  'xte', 'rpm', 'utc',
]);

/** Channels whose path-derived label reads poorly. */
export const CHANNEL_LABEL_OVERRIDES: Record<string, string> = {
  'nav.magvar': 'Magnetic variation',
};

/** Split a segment on camelCase boundaries into lower-case words. */
function splitWords(segment: string): string[] {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Human-readable label for a channel id: prettify the dotted path
 * (`boat.rudder.angle` → "Boat rudder angle"), splitting camelCase and
 * upper-casing known acronyms (GPS, COG, VMG, …). `CHANNEL_LABEL_OVERRIDES`
 * wins for ids that don't prettify cleanly.
 */
export function channelLabel(channel: string): string {
  const override = CHANNEL_LABEL_OVERRIDES[channel];
  if (override) return override;
  const words = channel
    .split('.')
    .flatMap(splitWords)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  if (words.length === 0) return channel;
  const first = words[0]!;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

/**
 * Classify a channel by its source tags: 'measured' if any source is from a
 * device (`n2k:`/`0183:`), else 'computed'.
 */
export function channelKind(sourcesForChannel: string[]): 'measured' | 'computed' {
  return sourcesForChannel.some((s) => s.startsWith('n2k:') || s.startsWith('0183:'))
    ? 'measured'
    : 'computed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/channel-label.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/lib/channel-label.ts packages/web/src/lib/channel-label.test.ts
git commit -m "feat(web): channel-label helper (friendly names + measured/computed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract `ChannelPanel` and refactor `SensorCard`

**Files:**
- Create: `packages/web/src/app/sensors/ChannelPanel.tsx`
- Modify: `packages/web/src/app/sensors/SensorCard.tsx` (full replacement)

- [ ] **Step 1: Create `ChannelPanel.tsx`**

```tsx
'use client';
import type { SourcePriorityRule } from '@g5000/core';
import { formatChannelValue } from '../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../lib/device-label';
import { pinnedSourceForChannel, setPinnedSource } from '../../lib/source-pin';
import { channelLabel } from '../../lib/channel-label';
import type { ObservedEntry } from './sensors-types';

interface ChannelPanelProps {
  channel: string;
  /** Observed entries for THIS channel only (any order). */
  entries: ObservedEntry[];
  rules: SourcePriorityRule[];
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
  /** Larger headline for a card's primary channel. */
  emphasis?: boolean;
}

/**
 * One channel: a headline value (reflecting the pin) plus a radio group —
 * `Auto` (most recent) or a single pinned source. Shared by the curated
 * SensorCards and the "All channels" section so pin behaviour is identical.
 */
export function ChannelPanel({
  channel,
  entries,
  rules,
  devices,
  saving,
  onSaveRules,
  emphasis = false,
}: ChannelPanelProps) {
  const pinned = pinnedSourceForChannel(rules, channel);
  const sorted = [...entries].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );

  // Rows: every observed source, plus the pinned source if it isn't currently
  // observed (kept visible so it stays selectable).
  const rows: { source: string; entry: ObservedEntry | null }[] = sorted.map((e) => ({
    source: e.source,
    entry: e,
  }));
  if (pinned && !sorted.some((e) => e.source === pinned)) {
    rows.push({ source: pinned, entry: null });
  }

  let headlineValue: string;
  if (pinned) {
    const pe = sorted.find((e) => e.source === pinned);
    headlineValue = pe ? formatChannelValue(pe.lastValue) : '—';
  } else {
    const fresh = sorted.reduce<ObservedEntry | null>(
      (best, e) => (!best || e.ageMs < best.ageMs ? e : best),
      null,
    );
    headlineValue = fresh ? formatChannelValue(fresh.lastValue) : '—';
  }

  const setPin = (source: string | null): void => {
    void onSaveRules(setPinnedSource(rules, channel, source));
  };

  return (
    <div className="space-y-1">
      <div
        className={
          'flex items-baseline justify-between gap-3 ' +
          (emphasis ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
        }
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="truncate">{channelLabel(channel)}</span>
          <span className="font-mono text-xs text-slate-600 truncate">{channel}</span>
        </span>
        <span className="tabular-nums">{headlineValue}</span>
      </div>

      <div className="pl-3 space-y-0.5 text-xs">
        <label className="flex items-center gap-2 cursor-pointer text-slate-400">
          <input
            type="radio"
            name={`pin-${channel}`}
            checked={pinned === null}
            onChange={() => setPin(null)}
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
                name={`pin-${channel}`}
                checked={pinned === source}
                onChange={() => setPin(source)}
                disabled={saving}
              />
              <span className="truncate flex-1 text-slate-300">{deviceLabel(source, devices)}</span>
              <span className="tabular-nums whitespace-nowrap">
                <span className="text-slate-300">
                  {entry ? formatChannelValue(entry.lastValue) : '—'}
                </span>
                {entry && (
                  <span className="text-slate-600"> · {(entry.ageMs / 1000).toFixed(1)}s</span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `SensorCard.tsx`** with the slimmed version that delegates to `ChannelPanel`:

```tsx
'use client';
import type { SourcePriorityRule } from '@g5000/core';
import type { DeviceLabelInfo } from '../../lib/device-label';
import { groupSourcesByChannel } from './group-sources';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';
import { ChannelPanel } from './ChannelPanel';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full source-priority config (passed through to each ChannelPanel). */
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
 * One curated sensor's card on /sensors: a freshness dot + name, a
 * ChannelPanel per channel (value + pin), and the "used by" / cal-page extras.
 */
export function SensorCard({ def, observed, rules, devices, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);
  const bySource = groupSourcesByChannel(own);

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
        {def.channels.map((ch, i) => (
          <ChannelPanel
            key={ch}
            channel={ch}
            entries={bySource.get(ch) ?? []}
            rules={rules}
            devices={devices}
            saving={saving}
            onSaveRules={onSaveRules}
            emphasis={i === 0}
          />
        ))}
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

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/ChannelPanel.tsx packages/web/src/app/sensors/SensorCard.tsx
git commit -m "refactor(web): extract ChannelPanel from SensorCard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `AllChannels` section + wire into the page

**Files:**
- Create: `packages/web/src/app/sensors/AllChannels.tsx`
- Modify: `packages/web/src/app/sensors/page.tsx`

- [ ] **Step 1: Create `AllChannels.tsx`**

```tsx
'use client';
import type { SourcePriorityRule } from '@g5000/core';
import type { DeviceLabelInfo } from '../../lib/device-label';
import { channelKind } from '../../lib/channel-label';
import { groupSourcesByChannel } from './group-sources';
import { SENSOR_DEFS } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';
import { ChannelPanel } from './ChannelPanel';

interface AllChannelsProps {
  observed: ObservedEntry[];
  rules: SourcePriorityRule[];
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
}

/** Channels already shown in a curated SensorCard — excluded from this section. */
const CURATED = new Set(SENSOR_DEFS.flatMap((d) => d.channels));

/**
 * Every live channel NOT in a curated card, grouped into Measured (from
 * devices) and Computed (g5000). Always expanded. Reuses ChannelPanel so the
 * value display + single-source pin behave exactly like the curated cards.
 */
export function AllChannels({ observed, rules, devices, saving, onSaveRules }: AllChannelsProps) {
  const byChannel = groupSourcesByChannel(observed);
  const others = [...byChannel.keys()].filter((ch) => !CURATED.has(ch)).sort();

  const measured: string[] = [];
  const computed: string[] = [];
  for (const ch of others) {
    const sources = (byChannel.get(ch) ?? []).map((e) => e.source);
    (channelKind(sources) === 'measured' ? measured : computed).push(ch);
  }

  const renderGroup = (title: string, channels: string[]) =>
    channels.length === 0 ? null : (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {channels.map((ch) => (
          <ChannelPanel
            key={ch}
            channel={ch}
            entries={byChannel.get(ch) ?? []}
            rules={rules}
            devices={devices}
            saving={saving}
            onSaveRules={onSaveRules}
          />
        ))}
      </div>
    );

  return (
    <section className="border border-slate-800 rounded bg-slate-900/40 p-4 space-y-4">
      <h2 className="text-base font-semibold text-slate-100">All channels</h2>
      {others.length === 0 ? (
        <div className="text-sm text-slate-500">No other channels.</div>
      ) : (
        <>
          {renderGroup('Measured (from devices)', measured)}
          {renderGroup('Computed (g5000)', computed)}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `page.tsx`**

Add the import after the existing `import { SensorCard } from './SensorCard';` line:
```ts
import { AllChannels } from './AllChannels';
```

In the JSX, immediately after the `{SENSOR_DEFS.map((def) => ( <SensorCard ... /> ))}` block (and before the closing `</main>`), add:
```tsx
      <AllChannels
        observed={observed}
        rules={rules}
        devices={devices}
        saving={saving}
        onSaveRules={onSaveRules}
      />
```

- [ ] **Step 3: Run the full gates**

```bash
cd /Users/gregjohnson/code/g5000 && npx tsc -b
cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/channel-label.test.ts packages/web/src/lib/source-pin.test.ts packages/web/src/lib/device-label.test.ts packages/web/src/app/sensors/group-sources.test.ts
cd /Users/gregjohnson/code/g5000/packages/web && npm run build
```
Expected: `tsc -b` exit 0; tests pass (6 + 7 + 8 + 3 = 24); `npm run build` succeeds with `/sensors` in the route manifest.

- [ ] **Step 4: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/AllChannels.tsx packages/web/src/app/sensors/page.tsx
git commit -m "feat(web): All channels section on /sensors (curated + everything)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks)

1. Open `/sensors`: curated cards on top, then an **All channels** section with **Measured (from devices)** and **Computed (g5000)** groups.
2. `wind.true.direction` appears under Computed showing `computed: true wind`; `boat.rudder.angle` / `autopilot.mode` under Measured with device names; `race.*` / `performance.* `/ `groove.*` / `tide.*` under Computed.
3. Channel labels are friendly (e.g. "Boat rudder angle", "Performance target VMG", "Magnetic variation") with the raw id in mono beside them.
4. Pinning a multi-source channel in the section behaves exactly like the curated cards.
