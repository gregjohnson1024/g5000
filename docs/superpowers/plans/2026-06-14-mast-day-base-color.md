# Mast Day Base Colour + Black Background — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the mast display's daytime theme black-background with a single settable base colour (one of 8) for cell values; alarm thresholds still override; night mode unchanged.

**Architecture:** Mirrors the night-mode feature. `DisplayConfig` gains `dayBaseColor`; exposed via `MastService.dayBaseColor$`; emitted as a `daybasecolor` SSE event; set via `POST /api/mast/day-base-color`; the `/mast` page sets `--mast-fg` to the chosen hex (day only); `mast.css` day theme flips to black bg + brightened thresholds; a swatch picker on `/mast-config`. g5000-only.

**Tech Stack:** TypeScript, ConfigStore (Drizzle/better-sqlite3), RxJS, Next.js routes, React 19, Vitest.

**Repo/branch:** g5000 at `/Users/gregjohnson/code/g5000`, all tasks on `feature/mast-day-base-color` (from `develop`). **Gates:** `npx tsc -b` + `npx vitest run packages/db packages/web/src/app/api/mast`.

> **Dependency-direction correction (vs the spec):** the spec put `DAY_BASE_COLORS` in `@g5000/db` defaults; that's wrong — `@g5000/db` depends on `@g5000/mast` (not the reverse), and `MastRuntime` (in mast) needs the type. So **define the colour names/type in `@g5000/mast`**; `@g5000/db` imports them.

---

## Task 1: Colour vocabulary (@g5000/mast) + DisplayConfig field (@g5000/db)

**Files:** Create `packages/mast/src/colors.ts`; Modify `packages/mast/src/index.ts`, `packages/db/src/defaults.ts`, `packages/db/src/config-store.test.ts`.

- [ ] **Step 1: Define the colour names + type in `@g5000/mast`**

Create `packages/mast/src/colors.ts`:

```ts
/** The selectable mast-display day base colours (high-contrast on black). */
export const DAY_BASE_COLORS = [
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta',
] as const;

export type DayBaseColor = (typeof DAY_BASE_COLORS)[number];
```

Export it from the package: add to `packages/mast/src/index.ts` (match the file's existing export style, e.g. `export * from './colors.js';`).

- [ ] **Step 2: Add `dayBaseColor` to `DisplayConfig` (`packages/db/src/defaults.ts`)**

Add an import (db already depends on @g5000/mast) and extend the type + default:

```ts
import type { DayBaseColor } from '@g5000/mast';
```

```ts
export interface DisplayConfig {
  brightnessPct: number;
  nightMode: boolean;
  /** Day-mode base colour for cell values (one of @g5000/mast DAY_BASE_COLORS). */
  dayBaseColor: DayBaseColor;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  brightnessPct: 80,
  nightMode: false,
  dayBaseColor: 'white',
};
```

(Match how defaults.ts already imports types, e.g. `Station` from `@g5000/tide` — a `import type` at the top.)

- [ ] **Step 3: Extend the ConfigStore round-trip test (`config-store.test.ts`)**

In the existing display-config test, change the `next` to also set the colour:

```ts
const next = {
  ...DEFAULT_DISPLAY_CONFIG,
  brightnessPct: 35,
  nightMode: true,
  dayBaseColor: 'green' as const,
};
```

- [ ] **Step 4: Verify**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/db/src/config-store.test.ts` → PASS.
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0. (Adding a required `dayBaseColor` is safe — all DisplayConfig writes use `{ ...getDisplayConfig(), ... }` spreads. If tsc flags a missing field anywhere, report it.)

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/mast/src/colors.ts packages/mast/src/index.ts packages/db/src/defaults.ts packages/db/src/config-store.test.ts
git commit -m "feat(mast,db): DayBaseColor vocabulary + DisplayConfig.dayBaseColor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Expose dayBaseColor on MastRuntime + the mast SSE

**Files:** Modify `packages/mast/src/types.ts`, `apps/g5000/src/mast/service.ts`, `packages/web/src/app/api/mast/stream/route.ts`.

- [ ] **Step 1: Runtime contract (`types.ts`)**

Import the type and extend `MastRuntime` (after the `nightMode$`/`getNightMode` members):

```ts
import type { DayBaseColor } from './colors.js';
```

```ts
  readonly dayBaseColor$: Observable<DayBaseColor>;
  getDayBaseColor(): DayBaseColor;
```

- [ ] **Step 2: `MastService` (`service.ts`)**

`map` is already imported. Add `DayBaseColor` to the existing `@g5000/mast` import (the file already imports `MastLayout`/`MastRuntime`/etc. from there), then add — next to `nightMode$`/`getNightMode`:

```ts
  get dayBaseColor$(): Observable<DayBaseColor> {
    return this.configStore.displayConfig$.pipe(map((c) => c.dayBaseColor));
  }

  getDayBaseColor(): DayBaseColor {
    return this.configStore.getDisplayConfig().dayBaseColor;
  }
```

- [ ] **Step 3: SSE emit (`stream/route.ts`)**

After `send('nightmode', mastRuntime.getNightMode());` add:

```ts
send('daybasecolor', mastRuntime.getDayBaseColor());
```

After the `nightModeSub` subscription add:

```ts
const dayBaseColorSub = mastRuntime.dayBaseColor$.subscribe((c) => send('daybasecolor', c));
```

In the abort handler add:

```ts
dayBaseColorSub.unsubscribe();
```

- [ ] **Step 4: Verify**
      Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0; `npx vitest run apps/g5000/src/mast` → pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/mast/src/types.ts apps/g5000/src/mast/service.ts packages/web/src/app/api/mast/stream/route.ts
git commit -m "feat(mast): expose dayBaseColor on MastRuntime + emit on mast SSE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: POST /api/mast/day-base-color (+ test)

**Files:** Create `packages/web/src/app/api/mast/day-base-color/route.ts` + `route.test.ts`.

- [ ] **Step 1: Failing test (`route.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-daycolor-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/day-base-color', () => {
  it('GET returns the default (white)', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; dayBaseColor: string };
    expect(body.ok).toBe(true);
    expect(body.dayBaseColor).toBe('white');
  });

  it('POST round-trips a valid colour', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ dayBaseColor: 'cyan' }) }),
    );
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { dayBaseColor: string };
    expect(back.dayBaseColor).toBe('cyan');
  });

  it('POST rejects an invalid colour', async () => {
    for (const v of ['mauve', 42, null]) {
      const res = await POST(
        new Request('http://x', { method: 'POST', body: JSON.stringify({ dayBaseColor: v }) }),
      );
      expect(res.status).toBe(400);
    }
  });
});
```

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/day-base-color` → FAIL (no module).

- [ ] **Step 2: Implement (`route.ts`)**

```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import { DAY_BASE_COLORS, type DayBaseColor } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { dayBaseColor } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, dayBaseColor });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { dayBaseColor?: unknown };
  if (
    typeof b.dayBaseColor !== 'string' ||
    !(DAY_BASE_COLORS as readonly string[]).includes(b.dayBaseColor)
  ) {
    return NextResponse.json(
      { ok: false, error: `dayBaseColor must be one of: ${DAY_BASE_COLORS.join(', ')}` },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({
    ...store.getDisplayConfig(),
    dayBaseColor: b.dayBaseColor as DayBaseColor,
  });
  return NextResponse.json({ ok: true, dayBaseColor: b.dayBaseColor });
}
```

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/day-base-color` → PASS (3); `npx tsc -b` → exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/api/mast/day-base-color/route.ts packages/web/src/app/api/mast/day-base-color/route.test.ts
git commit -m "feat(web): POST /api/mast/day-base-color setter (persists DisplayConfig)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Render — black bg, hex map, hook, page applies base colour

**Files:** Create `packages/web/src/app/mast/colors.ts`; Modify `packages/web/src/app/mast/mast.css`, `packages/web/src/hooks/use-mast-control.ts`, `packages/web/src/app/mast/page.tsx`.

- [ ] **Step 1: Hex map (`packages/web/src/app/mast/colors.ts`)**

```ts
import type { DayBaseColor } from '@g5000/mast';

/** Hex for each selectable day base colour — bright/high-contrast on black. */
export const MAST_BASE_COLOR_HEX: Record<DayBaseColor, string> = {
  white: '#ffffff',
  red: '#ff5555',
  orange: '#ff9f43',
  yellow: '#ffd23f',
  green: '#4ade80',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  magenta: '#e879f9',
};
```

- [ ] **Step 2: Black daytime theme (`mast.css`)**

Read the file. In the base `.mast-root` block (the DAY palette), change the values (leave the `.mast-root.mast-night` block UNCHANGED):

```css
--mast-bg: #000000; /* was #ffffff — black background always */
--mast-fg: #ffffff; /* was #0b0e14 — fallback; page overrides with the chosen base colour */
--mast-muted: #9ca3af; /* was #6b7280 — lighter grey, readable on black */
--mast-green: #4ade80; /* was #15803d — brightened for black contrast */
--mast-amber: #f59e0b; /* was #b45309 */
--mast-red: #ef4444; /* was #b91c1c */
```

(Keep any other vars/rules as-is. Match the exact property names present.)

- [ ] **Step 3: Hook (`use-mast-control.ts`)**

Add `dayBaseColor` (mirror the `nightMode` listener):

- Import the type: `import type { DayBaseColor } from '@g5000/mast';`
- `UseMastControlResult` gains `dayBaseColor: DayBaseColor;`
- State: `const [dayBaseColor, setDayBaseColor] = useState<DayBaseColor>('white');`
- Listener:
  ```ts
  es.addEventListener('daybasecolor', (ev) => {
    try {
      setDayBaseColor(JSON.parse((ev as MessageEvent).data) as DayBaseColor);
    } catch {
      /* ignore malformed payloads */
    }
  });
  ```
- Return `dayBaseColor`.

- [ ] **Step 4: Apply on the page (`mast/page.tsx`)**

- Import the hex map: `import { MAST_BASE_COLOR_HEX } from './colors';`
- Destructure `dayBaseColor` from the hook: `const { layout, override, nightMode, dayBaseColor } = useMastControl();`
- On the `.mast-root` div, add the inline `--mast-fg` ONLY in day mode (so night's red wins):

  ```tsx
    <div
      className={`mast-root${night ? ' mast-night' : ''}`}
      style={night ? undefined : ({ ['--mast-fg']: MAST_BASE_COLOR_HEX[dayBaseColor] } as React.CSSProperties)}
    >
  ```

  (Keep the rest of the div/children unchanged.)

- [ ] **Step 5: Verify**
      Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit` → clean.
      Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0; `npx vitest run packages/web/src/app/mast` → existing mast tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/mast/colors.ts packages/web/src/app/mast/mast.css packages/web/src/hooks/use-mast-control.ts packages/web/src/app/mast/page.tsx
git commit -m "feat(web): mast black bg + apply settable day base colour to values

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Day-base-colour picker on /mast-config

**Files:** Modify `packages/web/src/app/mast-config/page.tsx`.

The page already has the brightness slider + night toggle (loading via GET, POSTing on change). Add an 8-swatch colour picker alongside them.

- [ ] **Step 1: State + load + save**

- Import: `import { DAY_BASE_COLORS, type DayBaseColor } from '@g5000/mast';` and `import { MAST_BASE_COLOR_HEX } from '../mast/colors';`
- State: `const [dayBaseColor, setDayBaseColor] = useState<DayBaseColor>('white');`
- In `reload()`, after the night-mode fetch block (its own guarded try/catch), add:
  ```tsx
  try {
    const dcRes = await fetch('/api/mast/day-base-color', { cache: 'no-store' });
    if (dcRes.ok) {
      const dcBody = (await dcRes.json()) as { ok: boolean; dayBaseColor: DayBaseColor };
      if (dcBody.ok) setDayBaseColor(dcBody.dayBaseColor);
    }
  } catch {
    // non-fatal — day base colour stays at the default
  }
  ```
- Save handler:

  ```tsx
  const onDayBaseColorChange = (color: DayBaseColor): void => {
    setDayBaseColor(color);
    void fetch('/api/mast/day-base-color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayBaseColor: color }),
    });
  };
  ```

- [ ] **Step 2: Picker UI**

Add a `<section>` after the night-mode section, with 8 swatch buttons:

```tsx
<section className="border border-slate-700 rounded-md p-4 space-y-2">
  <div className="text-sm font-medium">Day base colour</div>
  <div className="flex flex-wrap gap-2">
    {DAY_BASE_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onDayBaseColorChange(c)}
        aria-label={c}
        aria-pressed={dayBaseColor === c}
        title={c}
        className={`w-8 h-8 rounded-full border-2 ${
          dayBaseColor === c ? 'border-slate-100' : 'border-slate-600'
        }`}
        style={{ backgroundColor: MAST_BASE_COLOR_HEX[c] }}
      />
    ))}
  </div>
  <p className="text-xs text-slate-400">
    Day-mode colour for cell values (black background). Alarm thresholds still override; night mode
    shows everything in red.
  </p>
</section>
```

- [ ] **Step 3: Verify**
      Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit` → clean.
      Run: `cd /Users/gregjohnson/code/g5000/packages/web && npm run build` → succeeds (`/mast-config` in manifest).
      Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/mast-config/page.tsx
git commit -m "feat(web): day-base-colour swatch picker on /mast-config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.
- [ ] `npx vitest run packages/db packages/web/src/app/api/mast` → pass (DisplayConfig + day-base-color route tests included).
- [ ] `cd packages/web && npm run build` → succeeds.
- [ ] Manual: pick a colour on `/mast-config` → day-mode `/mast` values change to it on a black background; alarm threshold cells still show green/amber/red; the night toggle still flips everything to red. (Kiosk needs a reload after the g5000 deploy to pick up the page change.)

## Notes

- `DayBaseColor`/`DAY_BASE_COLORS` live in `@g5000/mast` (db→mast dependency); the hex map lives in the web package (presentation).
- Night mode unchanged; base colour applied only in day mode (inline style omitted when night) so it never overrides the red.
- Page-rendered → kiosk reload required after deploy (known gotcha).
- Queued follow-ups (NOT this plan): rows×columns layout, one-line title+units/bigger fonts, graphical cells, display error states (network loss/stale data), and auto-reload-on-new-version for the kiosk.
