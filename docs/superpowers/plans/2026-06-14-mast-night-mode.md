# Manual Mast-Display Night Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manual, persisted night-mode toggle for the mast display — set remotely from g5000, it forces the existing red-on-black `.mast-night` theme on/off (replacing the automatic sun-driven switch).

**Architecture:** Extend the existing `DisplayConfig` (which holds `brightnessPct`) with `nightMode: boolean`; expose it via `MastService.nightMode$`; emit a `nightmode` event on the mast SSE; set it via `POST /api/mast/night-mode`; the `/mast` page reads it off the SSE (`use-mast-control`) and applies `.mast-night`; a toggle on `/mast-config`. g5000-only — the browser applies the CSS class, no appliance agent.

**Tech Stack:** TypeScript, Drizzle/better-sqlite3 ConfigStore, RxJS, Next.js route handlers, React 19, Vitest.

**Repo/branch:** g5000 at `/Users/gregjohnson/code/g5000`, all tasks on branch `feature/mast-night-mode` (from `develop`). **Gates:** `npx tsc -b` (exit 0) + `npx vitest run packages/db packages/web/src/app/api/mast` from repo root.

---

## Task 1: Add `nightMode` to DisplayConfig

**Files:** Modify `packages/db/src/defaults.ts`; Test `packages/db/src/config-store.test.ts`.

No schema/table change — `DisplayConfig` is a single JSON row, and ConfigStore's load already merges over `DEFAULT_DISPLAY_CONFIG`, so existing rows (with only `brightnessPct`) gain `nightMode: false` automatically.

- [ ] **Step 1: Extend the type + default (`defaults.ts`)**

Change the existing `DisplayConfig` interface and its default to:
```ts
export interface DisplayConfig {
  /** Panel backlight brightness, 0–100 % (UI-friendly; the unit maps to hardware). */
  brightnessPct: number;
  /** Force the mast display's red-on-black night theme on/off (manual). */
  nightMode: boolean;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  brightnessPct: 80,
  nightMode: false,
};
```

- [ ] **Step 2: Update the ConfigStore round-trip test (`config-store.test.ts`)**

The existing display-config test sets `brightnessPct`. Extend its `next` to also flip `nightMode` so the round-trip covers the new field. Replace the `const next = { ...DEFAULT_DISPLAY_CONFIG, brightnessPct: 35 };` line in that test with:
```ts
    const next = { ...DEFAULT_DISPLAY_CONFIG, brightnessPct: 35, nightMode: true };
```
(The `expect(store.getDisplayConfig()).toEqual(DEFAULT_DISPLAY_CONFIG)` assertion still holds because the default now includes `nightMode: false`.)

- [ ] **Step 3: Run the test + typecheck**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/db/src/config-store.test.ts` → PASS.
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.

- [ ] **Step 4: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/db/src/defaults.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): add nightMode to DisplayConfig

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Expose nightMode on MastRuntime + the mast SSE

**Files:** Modify `packages/mast/src/types.ts`, `apps/g5000/src/mast/service.ts`, `packages/web/src/app/api/mast/stream/route.ts`.

- [ ] **Step 1: Extend the runtime contract (`types.ts`)**

In `MastRuntime`, after the `brightness$`/`getBrightness` members, add:
```ts
  readonly nightMode$: Observable<boolean>;
  getNightMode(): boolean;
```

- [ ] **Step 2: Implement in `MastService` (`service.ts`)**

`map` is already imported (added for `brightness$`). Add, next to `brightness$`/`getBrightness`:
```ts
  get nightMode$(): Observable<boolean> {
    return this.configStore.displayConfig$.pipe(map((c) => c.nightMode));
  }

  getNightMode(): boolean {
    return this.configStore.getDisplayConfig().nightMode;
  }
```

- [ ] **Step 3: Emit on the SSE (`stream/route.ts`)**

After `send('brightness', mastRuntime.getBrightness());` add:
```ts
      send('nightmode', mastRuntime.getNightMode());
```
After the `const brightnessSub = mastRuntime.brightness$.subscribe(...)` line add:
```ts
      const nightModeSub = mastRuntime.nightMode$.subscribe((n) => send('nightmode', n));
```
In the `abort` handler, alongside the other `.unsubscribe()` calls, add:
```ts
        nightModeSub.unsubscribe();
```

- [ ] **Step 4: Verify**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run apps/g5000/src/mast` → existing mast tests pass.

- [ ] **Step 5: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/mast/src/types.ts apps/g5000/src/mast/service.ts packages/web/src/app/api/mast/stream/route.ts
git commit -m "feat(mast): expose nightMode on MastRuntime + emit on mast SSE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: POST /api/mast/night-mode setter (+ test)

**Files:** Create `packages/web/src/app/api/mast/night-mode/route.ts` + `route.test.ts`.

- [ ] **Step 1: Write the failing test (`route.test.ts`)**
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-nightmode-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/night-mode', () => {
  it('GET returns the default (false)', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; nightMode: boolean };
    expect(body.ok).toBe(true);
    expect(body.nightMode).toBe(false);
  });

  it('POST round-trips true', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ nightMode: true }) }));
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { nightMode: boolean };
    expect(back.nightMode).toBe(true);
  });

  it('POST rejects a non-boolean', async () => {
    for (const v of [1, 'true', null]) {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ nightMode: v }) }));
      expect(res.status).toBe(400);
    }
  });
});
```
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/night-mode` → FAIL (no module).

- [ ] **Step 2: Implement (`route.ts`)**
```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { nightMode } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, nightMode });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { nightMode?: unknown };
  if (typeof b.nightMode !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'nightMode must be a boolean' }, { status: 400 });
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), nightMode: b.nightMode });
  return NextResponse.json({ ok: true, nightMode: b.nightMode });
}
```
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/night-mode` → PASS (3). Then `npx tsc -b` → exit 0.

- [ ] **Step 3: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/api/mast/night-mode/route.ts packages/web/src/app/api/mast/night-mode/route.test.ts
git commit -m "feat(web): POST /api/mast/night-mode setter (persists DisplayConfig)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Apply nightMode on the /mast page (drop the auto sun-switch)

**Files:** Modify `packages/web/src/hooks/use-mast-control.ts`, `packages/web/src/app/mast/page.tsx`.

- [ ] **Step 1: Add `nightMode` to the hook (`use-mast-control.ts`)**

Read the file. It exposes `UseMastControlResult { layout, override, connected }` and subscribes to `/api/mast/stream` for `layout`/`override` events. Make these changes:
- Add `nightMode: boolean;` to the `UseMastControlResult` interface.
- Add state: `const [nightMode, setNightMode] = useState(false);`
- In the effect, add a listener mirroring the `override` one:
```ts
    es.addEventListener('nightmode', (ev) => {
      try {
        setNightMode(JSON.parse((ev as MessageEvent).data) as boolean);
      } catch {
        /* ignore malformed payloads */
      }
    });
```
- Add `nightMode` to the returned object.

- [ ] **Step 2: Apply it on the page (`mast/page.tsx`)**

The page currently has roughly:
```tsx
  const { layout, override } = useMastControl();
  ...
  const pos = geo(channels.get('nav.gps.position'));
  ...
  const night = pos ? isNight(pos.lat, pos.lon, new Date()) : false;
```
Change to:
- Destructure `nightMode` from the hook: `const { layout, override, nightMode } = useMastControl();`
- Replace the `night` computation with: `const night = nightMode;`
- Remove the now-unused `isNight` import. If `pos` (and the `geo` helper) are now unused, remove them too (strict tsc flags unused `pos` local + the unused `isNight` import; remove the `geo` function if it has no remaining caller). Verify by reading the file — `pos`/`geo` may have no other use once `isNight` is gone.

The `<div className={\`mast-root${night ? ' mast-night' : ''}\`}>` line is unchanged.

- [ ] **Step 3: Verify**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit` → clean (catches any leftover unused import/local).
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.

- [ ] **Step 4: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/hooks/use-mast-control.ts packages/web/src/app/mast/page.tsx
git commit -m "feat(web): mast page applies manual nightMode (drops auto sun-switch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Night-mode toggle on /mast-config

**Files:** Modify `packages/web/src/app/mast-config/page.tsx`.

The page already has the brightness slider (loads via `GET /api/mast/brightness`, POSTs on change). Add a night-mode toggle alongside it.

- [ ] **Step 1: State + load + save**

Add state near `brightnessPct`:
```tsx
  const [nightMode, setNightMode] = useState<boolean>(false);
```
In `reload()`, after the brightness fetch (guarded the same way), add:
```tsx
      const nmRes = await fetch('/api/mast/night-mode', { cache: 'no-store' });
      if (nmRes.ok) {
        const nmBody = (await nmRes.json()) as { ok: boolean; nightMode: boolean };
        if (nmBody.ok) setNightMode(nmBody.nightMode);
      }
```
Add a save handler (discrete toggle — no debounce):
```tsx
  const onNightModeChange = (on: boolean): void => {
    setNightMode(on);
    void fetch('/api/mast/night-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nightMode: on }),
    });
  };
```

- [ ] **Step 2: Toggle UI**

In the "Panel brightness" `<section>` (or a sibling section right after it), add a night-mode row matching the dark-theme idiom:
```tsx
      <section className="border border-slate-700 rounded-md p-4 space-y-2">
        <div className="text-sm font-medium">Night mode</div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={nightMode}
            onChange={(e) => onNightModeChange(e.target.checked)}
            aria-label="Night mode"
          />
          <span className="text-slate-300">{nightMode ? 'On — red on black' : 'Off — day theme'}</span>
        </label>
        <p className="text-xs text-slate-400">
          Forces the mast display's red-on-black night theme on/off. Persists across reboots.
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
git commit -m "feat(web): night-mode toggle on /mast-config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.
- [ ] `npx vitest run packages/db packages/web/src/app/api/mast` → all pass (DisplayConfig + night-mode route tests included).
- [ ] `cd packages/web && npm run build` → succeeds.
- [ ] Manual (recommended): on `/mast-config`, flip Night mode → the `/mast` display goes red-on-black instantly; reload → persists. (No appliance change; no redeploy of the unit needed beyond the g5000 deploy.)

## Notes
- Replaces the automatic `isNight` sun-switch with the manual toggle (manual-only, consistent with brightness). `isNight` stays in `@g5000/mast` (unused) for a possible future auto mode.
- Reuses the existing `.mast-night` CSS — no style changes.
- Queued follow-up brainstorms (NOT this plan): per-cell colours (8 options), rows×columns layout, one-line title+units/bigger fonts, graphical cells, and display error states (network loss / stale data).
