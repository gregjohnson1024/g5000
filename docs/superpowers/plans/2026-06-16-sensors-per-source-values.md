# Sensors per-source value breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the `/sensors` page, show each channel's value broken out per source device (e.g. `Garmin gWind (0x11) → 0°` vs `B&G WS320 (0x15) → 323°`) so a user can spot a rogue N2K broadcaster.

**Architecture:** Pure browser-side change in `packages/web`. The data already exists: `/api/sources/observed` returns one entry per (channel × source) with each source's own `lastValue`; `/api/devices` returns the N2K device registry. Add two small pure helpers (device label + grouping), render the breakdown in `SensorCard`, and fetch the device registry in the sensors page. No backend, bus, or appliance changes.

**Tech Stack:** Next.js 16 / React 19 (web), TypeScript composite (`tsc -b`), Vitest (node env; pure-logic tests only, no React harness).

**Spec:** `docs/superpowers/specs/2026-06-16-sensors-per-source-values.md`

**Branch:** all work on `feature/sensors-per-source-values` (branched from `develop`).

**Existing helpers (reuse, do not modify):** `packages/web/src/lib/friendly-source.ts` exports `parseN2kSource(tag) → { pgn: number; srcHex: string; src: number } | null` (note: `srcHex` already includes the `0x` prefix, e.g. `"0x11"`), `friendlySourceLabel(tag) → string`, `formatChannelValue(v: unknown) → string`. `packages/web/src/app/sensors/SourcePriorityEditor.tsx` exports `interface ObservedEntry { channel: string; source: string; lastSeenMs: number; ageMs: number; lastValue: unknown }`.

---

### Task 1: `deviceLabel()` pure helper

**Files:**
- Create: `packages/web/src/lib/device-label.ts`
- Test: `packages/web/src/lib/device-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/device-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deviceLabel, type DeviceLabelInfo } from './device-label';
import { friendlySourceLabel } from './friendly-source';

const mk = (entries: DeviceLabelInfo[]): Map<number, DeviceLabelInfo> =>
  new Map(entries.map((e) => [e.src, e]));

describe('deviceLabel', () => {
  it('uses manufacturer + model + address when both present', () => {
    const devices = mk([{ src: 0x11, manufacturerName: 'Garmin', modelId: 'gWind' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('Garmin gWind (0x11)');
  });

  it('uses manufacturer alone when model is missing', () => {
    const devices = mk([{ src: 0x11, manufacturerName: 'Garmin' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('Garmin (0x11)');
  });

  it('uses model alone when manufacturer is missing', () => {
    const devices = mk([{ src: 0x11, modelId: 'gWind' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('gWind (0x11)');
  });

  it('falls back to device function name when no product info', () => {
    const devices = mk([{ src: 0x15, deviceFunctionName: 'Wind' }]);
    expect(deviceLabel('n2k:130306@0x15', devices)).toBe('Wind (0x15)');
  });

  it('falls back to friendlySourceLabel when the device row is empty', () => {
    const devices = mk([{ src: 0x15 }]);
    const tag = 'n2k:130306@0x15';
    expect(deviceLabel(tag, devices)).toBe(friendlySourceLabel(tag));
  });

  it('falls back to friendlySourceLabel when no device row is known', () => {
    const tag = 'n2k:130306@0x11';
    expect(deviceLabel(tag, new Map())).toBe(friendlySourceLabel(tag));
  });

  it('labels computed sources via friendlySourceLabel', () => {
    expect(deviceLabel('computed:true_wind', new Map())).toBe('computed: true wind');
  });

  it('labels an unparseable tag via friendlySourceLabel', () => {
    expect(deviceLabel('demo', new Map())).toBe('demo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx vitest run src/lib/device-label.test.ts`
Expected: FAIL — cannot resolve `./device-label`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/device-label.ts`:

```ts
import { parseN2kSource, friendlySourceLabel } from './friendly-source';

/** Minimal device shape needed to label a source — a subset of the bridge's DeviceInfo. */
export interface DeviceLabelInfo {
  src: number;
  manufacturerName?: string;
  modelId?: string;
  deviceFunctionName?: string;
}

/**
 * Human label for a Sample `source` tag, enriched with N2K device info when
 * available (manufacturer/model/function + hex address). Falls back to
 * `friendlySourceLabel()` for computed/unknown sources or unmatched devices.
 */
export function deviceLabel(source: string, devices: Map<number, DeviceLabelInfo>): string {
  const parsed = parseN2kSource(source);
  if (!parsed) return friendlySourceLabel(source); // computed:* or unparseable
  const dev = devices.get(parsed.src);
  if (!dev) return friendlySourceLabel(source); // no device row known
  const name = [dev.manufacturerName, dev.modelId].filter(Boolean).join(' ').trim();
  if (name) return `${name} (${parsed.srcHex})`;
  if (dev.deviceFunctionName) return `${dev.deviceFunctionName} (${parsed.srcHex})`;
  return friendlySourceLabel(source); // device row exists but carries no useful label
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx vitest run src/lib/device-label.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/lib/device-label.ts packages/web/src/lib/device-label.test.ts
git commit -m "feat(web): deviceLabel() — N2K source tag → device name

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `groupSourcesByChannel()` pure helper

**Files:**
- Create: `packages/web/src/app/sensors/group-sources.ts`
- Test: `packages/web/src/app/sensors/group-sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/sensors/group-sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupSourcesByChannel } from './group-sources';
import type { ObservedEntry } from './SourcePriorityEditor';

const e = (channel: string, source: string): ObservedEntry => ({
  channel,
  source,
  lastSeenMs: 0,
  ageMs: 0,
  lastValue: null,
});

describe('groupSourcesByChannel', () => {
  it('groups multiple sources under one channel, sorted by source tag', () => {
    const out = groupSourcesByChannel([
      e('wind.true.direction', 'n2k:130306@0x15'),
      e('wind.true.direction', 'n2k:130306@0x11'),
      e('wind.true.direction', 'computed:true_wind'),
    ]);
    expect(out.get('wind.true.direction')?.map((x) => x.source)).toEqual([
      'computed:true_wind',
      'n2k:130306@0x11',
      'n2k:130306@0x15',
    ]);
  });

  it('separates distinct channels', () => {
    const out = groupSourcesByChannel([
      e('depth', 'n2k:128267@0x20'),
      e('wind.true.direction', 'n2k:130306@0x11'),
    ]);
    expect([...out.keys()].sort()).toEqual(['depth', 'wind.true.direction']);
    expect(out.get('depth')).toHaveLength(1);
  });

  it('returns an empty map for no entries', () => {
    expect(groupSourcesByChannel([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx vitest run src/app/sensors/group-sources.test.ts`
Expected: FAIL — cannot resolve `./group-sources`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/app/sensors/group-sources.ts`:

```ts
import type { ObservedEntry } from './SourcePriorityEditor';

/**
 * Group observed entries by channel for the per-source breakdown on a sensor
 * card. Each channel's list is sorted by source tag for stable display order.
 */
export function groupSourcesByChannel(own: ObservedEntry[]): Map<string, ObservedEntry[]> {
  const out = new Map<string, ObservedEntry[]>();
  for (const entry of own) {
    const list = out.get(entry.channel);
    if (list) list.push(entry);
    else out.set(entry.channel, [entry]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx vitest run src/app/sensors/group-sources.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/group-sources.ts packages/web/src/app/sensors/group-sources.test.ts
git commit -m "feat(web): groupSourcesByChannel() helper for sensor cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Render per-source breakdown in `SensorCard`

**Files:**
- Modify: `packages/web/src/app/sensors/SensorCard.tsx` (full replacement below)

This adds a `devices` prop and, under each channel's headline value, a per-source list (`deviceLabel · value · age`). The freshest-per-channel headline, freshness dot, "Directly used by", cal-page link, and the `SourcePriorityEditor` are unchanged. The old combined "Source: …" line is removed (the per-source list supersedes it). Note the import of `friendlySourceLabel` is dropped — it's no longer used here.

- [ ] **Step 1: Replace the file**

Overwrite `packages/web/src/app/sensors/SensorCard.tsx` with:

```tsx
'use client';
import { formatChannelValue } from '../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../lib/device-label';
import { groupSourcesByChannel } from './group-sources';
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
 * One sensor's card on /sensors. Shows, per channel, the freshest value as a
 * headline plus a per-source breakdown (each source's own value + age), so
 * competing/disagreeing broadcasters are visible. The freshness dot tracks the
 * most-recent sample across this sensor's channels.
 */
export function SensorCard({ def, observed, rules, devices, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);

  // Freshest entry per channel for the headline value.
  const latestByChannel = new Map<string, ObservedEntry>();
  for (const e of own) {
    const prev = latestByChannel.get(e.channel);
    if (!prev || e.ageMs < prev.ageMs) latestByChannel.set(e.channel, e);
  }

  // All sources per channel for the breakdown.
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

      <div className="space-y-2">
        {def.channels.map((ch, i) => {
          const headline = latestByChannel.get(ch);
          const value = headline ? formatChannelValue(headline.lastValue) : '—';
          const sources = bySource.get(ch) ?? [];
          return (
            <div key={ch} className="space-y-0.5">
              <div
                className={
                  'flex items-baseline justify-between gap-3 ' +
                  (i === 0 ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
                }
              >
                <span className="font-mono text-xs text-slate-500">{ch}</span>
                <span className="tabular-nums">{value}</span>
              </div>
              {sources.length === 0 ? (
                <div className="text-xs text-slate-500 pl-3">No source observed.</div>
              ) : (
                <ul className="text-xs text-slate-400 pl-3 space-y-0.5">
                  {sources.map((e) => (
                    <li key={e.source} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{deviceLabel(e.source, devices)}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        <span className="text-slate-300">{formatChannelValue(e.lastValue)}</span>
                        <span className="text-slate-600"> · {(e.ageMs / 1000).toFixed(1)}s</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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

- [ ] **Step 2: Verify it compiles (page.tsx not yet passing `devices` — expect a type error there only)**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit 2>&1 | head`
Expected: the only error is in `page.tsx` — `<SensorCard>` is missing the required `devices` prop (fixed in Task 4). No errors inside `SensorCard.tsx` itself.

- [ ] **Step 3: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/SensorCard.tsx
git commit -m "feat(web): per-source value breakdown on sensor cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fetch device registry in the sensors page and pass it down

**Files:**
- Modify: `packages/web/src/app/sensors/page.tsx`

Add a `devices` state, a `useEffect` that loads `/api/devices` on mount and every 15 s (tolerating errors), and pass `devices` to each `SensorCard`. This completes the wiring and clears the Task 3 type error.

- [ ] **Step 1: Add the import**

In `packages/web/src/app/sensors/page.tsx`, change the imports at the top so the `DeviceLabelInfo` type is available. After the existing line `import type { ObservedEntry, SourcePriorityRule } from './SourcePriorityEditor';` add:

```ts
import type { DeviceLabelInfo } from '../../lib/device-label';
```

- [ ] **Step 2: Add the devices-response type and poll constant**

Immediately after the existing `interface ObservedResponse { ... }` block, add:

```ts
interface DevicesResponse {
  devices: Array<{
    src: number;
    manufacturerName?: string;
    modelId?: string;
    deviceFunctionName?: string;
  }>;
}

const DEVICES_POLL_MS = 15000;
```

- [ ] **Step 3: Add devices state**

After the existing line `const [saving, setSaving] = useState(false);` add:

```ts
  const [devices, setDevices] = useState<Map<number, DeviceLabelInfo>>(new Map());
```

- [ ] **Step 4: Add the devices-loading effect**

Immediately after the "Poll observed sources." `useEffect(...)` block (the one that ends with `}, []);` near the top), insert a new effect:

```ts
  // Load the N2K device registry (for friendly source names). Best-effort:
  // on failure, source labels just fall back to PGN+address.
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET devices: ${res.status}`);
        const body = (await res.json()) as DevicesResponse;
        if (!alive) return;
        const map = new Map<number, DeviceLabelInfo>();
        for (const d of body.devices) {
          map.set(d.src, {
            src: d.src,
            manufacturerName: d.manufacturerName,
            modelId: d.modelId,
            deviceFunctionName: d.deviceFunctionName,
          });
        }
        setDevices(map);
      } catch {
        // Non-fatal — labels fall back to PGN+address.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), DEVICES_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
```

- [ ] **Step 5: Pass `devices` to each card**

In the `SENSOR_DEFS.map(...)` render, add the `devices` prop to `<SensorCard>`:

```tsx
        <SensorCard
          key={def.id}
          def={def}
          observed={observed}
          rules={rules}
          devices={devices}
          saving={saving}
          onSaveRules={onSaveRules}
        />
```

- [ ] **Step 6: Run the full gates**

```bash
cd /Users/gregjohnson/code/g5000 && npx tsc -b
cd /Users/gregjohnson/code/g5000/packages/web && npx vitest run src/lib/device-label.test.ts src/app/sensors/group-sources.test.ts && npm run build
```
Expected: `tsc -b` exit 0; both test files pass; `npm run build` succeeds and lists `/sensors` in the route manifest.

- [ ] **Step 7: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/sensors/page.tsx
git commit -m "feat(web): load N2K device registry on /sensors for source names

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks)

1. Run the dev server (or deploy), open `/sensors`.
2. A channel fed by more than one source (e.g. wind true direction) shows each source's own value with a device name and age.
3. Confirm the rogue source (the one reporting the wildly different value) is now visible.
4. Expand "Source priorities" on that card and deprioritize/pin to fix it (existing feature, unchanged).
5. With the device registry empty/unreachable, labels fall back to `Wind · 0x11` and values still render.
