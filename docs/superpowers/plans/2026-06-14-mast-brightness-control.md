# Remote Mast-Display Brightness Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set the Chipsee mast-display panel's brightness remotely from g5000 — a persisted value with a slider in g5000, broadcast over the mast SSE, applied to the panel's PWM backlight by an appliance agent that also dims the boot splash.

**Architecture:** g5000 gets a persisted `DisplayConfig { brightnessPct }` (mirrors `TideConfig`), exposed via `MastService.brightness$`, emitted as a `brightness` SSE event on `/api/mast/stream`, set via `POST /api/mast/brightness`, with a slider on `/mast-config`. On the Chipsee unit (the `sula-mast-display` repo), a systemd agent streams that SSE and writes `/sys/class/backlight/pwm-backlight/brightness` (+ caches it), and an early-boot oneshot applies the cached value. The sun-based auto-dimmer is removed (manual-only).

**Tech Stack:** g5000 — TypeScript, Drizzle/better-sqlite3 ConfigStore, RxJS, Next.js route handlers, React 19, Vitest. Appliance — bash + curl + systemd on Raspberry Pi OS (Debian 12).

**Two repos / branches:**
- **g5000** at `/Users/gregjohnson/code/g5000` — Tasks 1–4 on branch `feature/mast-brightness` (branch from `develop`).
- **sula-mast-display** at `/Users/gregjohnson/code/sula-mast-display` — Tasks 5–7 committed on its current branch (appliance work commits directly there, as in prior appliance changes).

**Build gates (g5000):** `npx tsc -b` (exit 0) and `npx vitest run` from repo root.

---

## Task 1: g5000 — persisted DisplayConfig in ConfigStore

**Repo/branch:** g5000, `feature/mast-brightness`.
**Files:**
- Modify: `packages/db/src/defaults.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store.test.ts`

- [ ] **Step 1: Add the type + default (`defaults.ts`)**

Append near the other per-boat configs (e.g. after `DEFAULT_TIDE_CONFIG`):
```ts
/** Per-boat mast-display panel settings. Applied by the appliance brightness agent. */
export interface DisplayConfig {
  /** Panel backlight brightness, 0–100 % (UI-friendly; the unit maps to hardware). */
  brightnessPct: number;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  brightnessPct: 80,
};
```

- [ ] **Step 2: Add the table (`schema.ts`)**

After the `tideConfig` table (mirror it exactly — per-boat row):
```ts
export const displayConfig = sqliteTable('display_config', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});
```

- [ ] **Step 3: Write the failing ConfigStore test (`config-store.test.ts`)**

Add `DEFAULT_DISPLAY_CONFIG` to the existing `from './defaults.js'` import in the test, and add this case (mirrors the TideConfig/GrooveSettings round-trip tests):
```ts
  it('seeds display config with defaults and persists a set across reopen', async () => {
    expect(store.getDisplayConfig()).toEqual(DEFAULT_DISPLAY_CONFIG);
    const next = { ...DEFAULT_DISPLAY_CONFIG, brightnessPct: 35 };
    await store.setDisplayConfig(next);
    await store.close();
    store = await ConfigStore.open(dbPath);
    expect(store.getDisplayConfig()).toEqual(next);
  });
```
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/db/src/config-store.test.ts` → FAIL (`getDisplayConfig` not a function).

- [ ] **Step 4: Wire DisplayConfig into `config-store.ts`** (mirror every `tideConfig` touch-point)

(a) In the `from './defaults.js'` import block add: `DEFAULT_DISPLAY_CONFIG,` and `type DisplayConfig,`.
(b) In the `from './schema.js'` import block add: `displayConfig as displayConfigTable,`.
(c) In the `type SubjectValues` block add: `displayConfig: DisplayConfig;`.
(d) In `open()`, inside the `raw.exec(...)` DDL string, add (next to the `tide_config` CREATE):
```sql
      CREATE TABLE IF NOT EXISTS display_config (
        boat_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
```
(e) In `open()`, after the tideConfig load-merge block, add the same shape:
```ts
    const dcRows = db
      .select()
      .from(displayConfigTable)
      .where(eq(displayConfigTable.boatId, activeBoatId))
      .all() as Array<{ boatId: string; value: string }>;
    const displayConfigValue: DisplayConfig = dcRows[0]
      ? {
          ...DEFAULT_DISPLAY_CONFIG,
          ...(JSON.parse(dcRows[0].value) as Partial<DisplayConfig>),
        }
      : DEFAULT_DISPLAY_CONFIG;
```
(f) In the `initial` object passed to the constructor, add: `displayConfig: displayConfigValue,`.
(g) Add the getters/setter near `tideConfig$`/`getTideConfig`/`setTideConfig` (mirror `setTideConfig`'s raw prepared-statement exactly — it uses `this.raw` and `this.__activeBoatId`):
```ts
  get displayConfig$(): Observable<DisplayConfig> {
    return this.subjects.displayConfig.asObservable();
  }

  getDisplayConfig(): DisplayConfig {
    return this.subjects.displayConfig.value;
  }

  async setDisplayConfig(value: DisplayConfig): Promise<void> {
    this.raw
      .prepare(
        'INSERT INTO display_config (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
      )
      .run(this.__activeBoatId, JSON.stringify(value));
    this.subjects.displayConfig.next(value);
  }
```
> Note: `DisplayConfig` (and `DEFAULT_DISPLAY_CONFIG`) must be reachable from `@g5000/db` for the route in Task 3. The package re-exports `./defaults.js` (that's why `CrossoverSettings` imports from `@g5000/db`), so this is automatic — verify after Step 5 that `import { type DisplayConfig } from '@g5000/db'` resolves; if not, add the export to `packages/db/src/index.ts` next to the other defaults re-exports.

- [ ] **Step 5: Run the test + typecheck**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/db/src/config-store.test.ts` → PASS.
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.

- [ ] **Step 6: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/db/src/defaults.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): persisted DisplayConfig { brightnessPct } in ConfigStore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: g5000 — expose brightness on MastRuntime + the mast SSE

**Repo/branch:** g5000, `feature/mast-brightness`.
**Files:**
- Modify: `packages/mast/src/types.ts`
- Modify: `apps/g5000/src/mast/service.ts`
- Modify: `packages/web/src/app/api/mast/stream/route.ts`

No new unit test (SSE/runtime wiring — covered by `tsc -b`, the existing `service.test.ts`, and the Task 3 route test / manual). 

- [ ] **Step 1: Extend the runtime contract (`packages/mast/src/types.ts`)**

In the `MastRuntime` interface add, after `override$`/`getOverride`:
```ts
  readonly brightness$: Observable<number>;
  getBrightness(): number;
```

- [ ] **Step 2: Implement it in `MastService` (`apps/g5000/src/mast/service.ts`)**

Add `map` to the rxjs import: change `import { BehaviorSubject, filter, type Observable } from 'rxjs';` to `import { BehaviorSubject, filter, map, type Observable } from 'rxjs';`.

Add these members (mirror the `layout$` passthrough — brightness is sourced from the persisted `displayConfig$`, NOT an in-memory subject):
```ts
  get brightness$(): Observable<number> {
    return this.configStore.displayConfig$.pipe(map((c) => c.brightnessPct));
  }

  getBrightness(): number {
    return this.configStore.getDisplayConfig().brightnessPct;
  }
```

- [ ] **Step 3: Emit it on the SSE (`packages/web/src/app/api/mast/stream/route.ts`)**

After `send('override', mastRuntime.getOverride());` add:
```ts
      send('brightness', mastRuntime.getBrightness());
```
After `const overrideSub = mastRuntime.override$.subscribe(...)` add:
```ts
      const brightnessSub = mastRuntime.brightness$.subscribe((b) => send('brightness', b));
```
In the `abort` handler, alongside the other `.unsubscribe()` calls, add:
```ts
        brightnessSub.unsubscribe();
```

- [ ] **Step 4: Typecheck + existing tests**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run apps/g5000/src/mast` → existing mast service tests pass.

- [ ] **Step 5: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/mast/src/types.ts apps/g5000/src/mast/service.ts packages/web/src/app/api/mast/stream/route.ts
git commit -m "feat(mast): expose brightness on MastRuntime + emit on mast SSE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: g5000 — POST /api/mast/brightness setter (+ test)

**Repo/branch:** g5000, `feature/mast-brightness`.
**Files:**
- Create: `packages/web/src/app/api/mast/brightness/route.ts`
- Test: `packages/web/src/app/api/mast/brightness/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `packages/web/src/app/api/mast/brightness/route.test.ts` (mirrors `crossover-settings/route.test.ts`):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, _resetSharedConfigStoreForTests } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/mast-brightness-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('/api/mast/brightness', () => {
  it('GET returns the default brightness', async () => {
    const body = (await (await GET()).json()) as { ok: boolean; brightnessPct: number };
    expect(body.ok).toBe(true);
    expect(body.brightnessPct).toBe(80);
  });

  it('POST round-trips a valid value', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ brightnessPct: 30 }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const back = (await (await GET()).json()) as { brightnessPct: number };
    expect(back.brightnessPct).toBe(30);
  });

  it('POST rejects out-of-range / non-integer', async () => {
    for (const v of [-1, 101, 4.2, 'x']) {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ brightnessPct: v }) }));
      expect(res.status).toBe(400);
    }
  });
});
```
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/brightness` → FAIL (no module).

- [ ] **Step 2: Implement the route**

Create `packages/web/src/app/api/mast/brightness/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { brightnessPct } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, brightnessPct });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { brightnessPct?: unknown };
  if (
    typeof b.brightnessPct !== 'number' ||
    !Number.isInteger(b.brightnessPct) ||
    b.brightnessPct < 0 ||
    b.brightnessPct > 100
  ) {
    return NextResponse.json(
      { ok: false, error: 'brightnessPct must be an integer 0–100' },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), brightnessPct: b.brightnessPct });
  return NextResponse.json({ ok: true, brightnessPct: b.brightnessPct });
}
```
Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/app/api/mast/brightness` → PASS. Then `npx tsc -b` → exit 0.

- [ ] **Step 3: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/api/mast/brightness/route.ts packages/web/src/app/api/mast/brightness/route.test.ts
git commit -m "feat(web): POST /api/mast/brightness setter (persists DisplayConfig)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: g5000 — brightness slider on /mast-config

**Repo/branch:** g5000, `feature/mast-brightness`.
**Files:**
- Modify: `packages/web/src/app/mast-config/page.tsx`

UI; verified by `tsc --noEmit` + `npm run build` + manual. Read the file first to match its exact state/structure.

- [ ] **Step 1: Add brightness state + load + debounced save**

Add `useRef` to the react import if not present (`import { useCallback, useEffect, useRef, useState } from 'react';`). Add state near the others:
```tsx
  const [brightnessPct, setBrightnessPct] = useState<number>(80);
  const brightnessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```
In `reload()` (after the layout/channels fetches), also load the current brightness:
```tsx
      const brRes = await fetch('/api/mast/brightness', { cache: 'no-store' });
      if (brRes.ok) {
        const brBody = (await brRes.json()) as { ok: boolean; brightnessPct: number };
        if (brBody.ok) setBrightnessPct(brBody.brightnessPct);
      }
```
Add the change handler (live slider + debounced POST so dragging isn't chatty):
```tsx
  const onBrightnessChange = (pct: number): void => {
    setBrightnessPct(pct);
    if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
    brightnessTimer.current = setTimeout(() => {
      void fetch('/api/mast/brightness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brightnessPct: pct }),
      });
    }, 250);
  };
```

- [ ] **Step 2: Add the slider section to the JSX**

Slot a section into the `<main className="p-6 space-y-6 max-w-4xl">` (e.g. right after the Save button, before the per-page `.map`), matching the file's dark-theme Tailwind idiom:
```tsx
      <section className="border border-slate-700 rounded-md p-4 space-y-2">
        <div className="text-sm font-medium">Panel brightness</div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={brightnessPct}
            onChange={(e) => onBrightnessChange(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono">{brightnessPct}%</span>
        </label>
        <p className="text-xs text-slate-400">
          Applied to the mast-display panel live. The setting persists and dims the boot screen too.
        </p>
      </section>
```

- [ ] **Step 3: Verify**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit` → clean.
Run: `cd /Users/gregjohnson/code/g5000/packages/web && npm run build` → succeeds (`/mast-config` in the manifest).
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.

- [ ] **Step 4: Commit**
```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/mast-config/page.tsx
git commit -m "feat(web): brightness slider on /mast-config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: appliance — brightness agent (SSE → backlight)

**Repo:** sula-mast-display (`/Users/gregjohnson/code/sula-mast-display`), current branch.
**Files:**
- Create: `appliance/brightness-agent.sh`
- Create: `appliance/mast-brightness.service`

- [ ] **Step 1: Create `appliance/brightness-agent.sh`**
```bash
#!/usr/bin/env bash
# Subscribe to g5000's mast-control SSE and apply the broadcast brightness to
# the Chipsee panel's PWM backlight; cache the raw value for the boot dimmer.
# Runs as a systemd service (Restart=always); curl streams until the SSE drops,
# then systemd reconnects (the stream replays the current value on connect).
set -uo pipefail

ENV_FILE="${MAST_ENV_FILE:-/etc/mast-display.env}"
# shellcheck source=/dev/null
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

MAST_URL="${MAST_URL:-https://g5000.sulabassana.net/mast}"
# Derive the SSE URL from MAST_URL (strip a trailing /mast), or override directly.
SSE_URL="${MAST_SSE_URL:-${MAST_URL%/mast}/api/mast/stream}"
BL_DIR="/sys/class/backlight/pwm-backlight"
CACHE_FILE="/var/lib/mast-display/brightness"
MIN_RAW="${MAST_BACKLIGHT_MIN:-2}"

# Map a 0–100 percent to a raw backlight value, clamped to [MIN_RAW, max].
pct_to_raw() {
  local pct="$1" max="$2" raw
  [ "$pct" -lt 0 ] && pct=0
  [ "$pct" -gt 100 ] && pct=100
  raw=$(( (pct * max + 50) / 100 ))   # round to nearest
  [ "$raw" -lt "$MIN_RAW" ] && raw="$MIN_RAW"
  [ "$raw" -gt "$max" ] && raw="$max"
  printf '%s' "$raw"
}

apply_pct() {
  local pct="$1" max raw
  [ -e "$BL_DIR/max_brightness" ] || return 0
  max="$(cat "$BL_DIR/max_brightness")"
  raw="$(pct_to_raw "$pct" "$max")"
  echo "$raw" > "$BL_DIR/brightness" 2>/dev/null || true
  # Atomic cache write for the boot dimmer.
  if echo "$raw" > "$CACHE_FILE.tmp" 2>/dev/null; then
    mv -f "$CACHE_FILE.tmp" "$CACHE_FILE" 2>/dev/null || true
  fi
  echo "[brightness] pct=${pct} -> raw=${raw}/${max}"
}

# Standalone self-test of the pure mapping (no hardware): brightness-agent.sh --selftest
if [ "${1:-}" = "--selftest" ]; then
  MIN_RAW=2
  fail=0
  check() { [ "$(pct_to_raw "$1" "$2")" = "$3" ] || { echo "FAIL pct=$1 max=$2 -> $(pct_to_raw "$1" "$2") (want $3)"; fail=1; }; }
  check 0 99 2      # 0% -> floor
  check 1 99 2      # rounds to 1 but floored to 2
  check 50 99 50    # round(49.5)=50
  check 100 99 99   # full
  check 120 99 99   # clamp high
  [ "$fail" = 0 ] && echo "selftest OK"
  exit "$fail"
fi

mkdir -p "$(dirname "$CACHE_FILE")" 2>/dev/null || true

# Stream the SSE. --connect-timeout fails fast when g5000 is unreachable (boot/
# outage) so systemd restarts us promptly rather than hanging on connect.
event=""
curl -NsS --connect-timeout 8 "$SSE_URL" | while IFS= read -r line; do
  case "$line" in
    "event: "*) event="${line#event: }" ;;
    "data: "*)
      data="${line#data: }"
      if [ "$event" = "brightness" ]; then
        case "$data" in
          ''|*[!0-9]*) : ;;          # ignore non-integer payloads
          *) apply_pct "$data" ;;
        esac
      fi
      ;;
    "") event="" ;;                  # blank line terminates an SSE event
  esac
done
```

- [ ] **Step 2: Create `appliance/mast-brightness.service`**
```ini
[Unit]
Description=Mast display brightness agent (applies g5000 brightness to the panel)
# Deliberately NOT ordered after network-online.target (that adds ~27s of boot
# delay). The agent fails-fast and systemd restarts it until g5000 is reachable.
After=network.target

[Service]
Type=simple
User=pi
EnvironmentFile=-/etc/mast-display.env
ExecStart=/usr/local/bin/mast-brightness-agent.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Verify**
Run: `cd /Users/gregjohnson/code/sula-mast-display && bash -n appliance/brightness-agent.sh && echo OK`
Run: `bash appliance/brightness-agent.sh --selftest` → prints `selftest OK`, exit 0.

- [ ] **Step 4: Commit**
```bash
cd /Users/gregjohnson/code/sula-mast-display
git add appliance/brightness-agent.sh appliance/mast-brightness.service
git commit -m "feat(appliance): brightness agent — SSE from g5000 -> PWM backlight + cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: appliance — early-boot brightness (dim the splash)

**Repo:** sula-mast-display, current branch.
**Files:**
- Create: `appliance/brightness-boot.sh`
- Create: `appliance/mast-brightness-boot.service`

- [ ] **Step 1: Create `appliance/brightness-boot.sh`**
```bash
#!/usr/bin/env bash
# Apply the cached backlight value as early as possible at boot so the splash
# comes up at the last-set brightness (no network needed). Falls back to ~80%.
set -uo pipefail
BL_DIR="/sys/class/backlight/pwm-backlight"
CACHE_FILE="/var/lib/mast-display/brightness"

[ -e "$BL_DIR/brightness" ] || exit 0
if [ -r "$CACHE_FILE" ]; then
  raw="$(cat "$CACHE_FILE" 2>/dev/null)"
else
  max="$(cat "$BL_DIR/max_brightness" 2>/dev/null || echo 99)"
  raw=$(( (80 * max + 50) / 100 ))
fi
case "$raw" in ''|*[!0-9]*) exit 0 ;; esac   # guard against a corrupt cache
echo "$raw" > "$BL_DIR/brightness" 2>/dev/null || true
```

- [ ] **Step 2: Create `appliance/mast-brightness-boot.service`**
```ini
[Unit]
Description=Apply cached mast-display brightness early at boot (dim the splash)
DefaultDependencies=no
After=local-fs.target
Before=sysinit.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mast-brightness-boot.sh

[Install]
WantedBy=sysinit.target
```
> Ordering note: the goal is to write the backlight as early as possible once the root fs is mounted (the cache lives in `/var/lib`) and the backlight node exists (it's a kernel DT overlay, available early). The `DefaultDependencies=no` / `Before=sysinit.target` ordering is a starting point; verify on the unit that it runs before the splash is up and adjust if needed (e.g. drop `Before=sysinit.target` if it causes an ordering cycle warning in `systemd-analyze verify`).

- [ ] **Step 3: Verify**
Run: `cd /Users/gregjohnson/code/sula-mast-display && bash -n appliance/brightness-boot.sh && echo OK`
Run (if available): `systemd-analyze verify appliance/mast-brightness-boot.service 2>&1 || echo "verify unavailable (OK on macOS)"`.

- [ ] **Step 4: Commit**
```bash
cd /Users/gregjohnson/code/sula-mast-display
git add appliance/brightness-boot.sh appliance/mast-brightness-boot.service
git commit -m "feat(appliance): early-boot dimmer applies cached brightness to the splash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: appliance — provision wiring + remove the auto-dimmer

**Repo:** sula-mast-display, current branch.
**Files:**
- Modify: `appliance/provision.sh`
- Modify: `appliance/README.md`
- Delete: `appliance/backlight-sync.sh`, `appliance/mast-backlight.service`, `appliance/mast-backlight.timer`

- [ ] **Step 1: Update `provision.sh`** — replace the optional backlight-dimmer block with the brightness agent + boot dimmer, and remove the old auto-dimmer.

Find the existing block that begins with the comment about the optional backlight day/night dimmer (it conditionally installs `backlight-sync.sh` + `mast-backlight.{service,timer}`). Replace that entire block with:
```bash
# Remote brightness: agent (SSE from g5000 -> PWM backlight) + early-boot dimmer.
install -d -o pi -g pi /var/lib/mast-display
install -m 0755 "$DIR/brightness-agent.sh" /usr/local/bin/mast-brightness-agent.sh
install -m 0755 "$DIR/brightness-boot.sh" /usr/local/bin/mast-brightness-boot.sh
install -m 0644 "$DIR/mast-brightness.service" /etc/systemd/system/mast-brightness.service
install -m 0644 "$DIR/mast-brightness-boot.service" /etc/systemd/system/mast-brightness-boot.service

# Remove the superseded sun-based auto-dimmer (manual remote control only now).
systemctl disable --now mast-backlight.timer 2>/dev/null || true
systemctl disable --now mast-backlight.service 2>/dev/null || true
rm -f /usr/local/bin/mast-backlight-sync.sh \
      /etc/systemd/system/mast-backlight.service \
      /etc/systemd/system/mast-backlight.timer
systemctl reset-failed mast-backlight.service mast-backlight.timer 2>/dev/null || true
```
Then, near the existing `systemctl enable mast-display.service`, add (and remove any `mast-backlight.timer` enable that referenced the old dimmer):
```bash
systemctl enable mast-brightness.service mast-brightness-boot.service
```
Update the closing echo hints to mention brightness is controlled from g5000's `/mast-config` slider.

- [ ] **Step 2: Delete the old auto-dimmer files from the repo**
```bash
cd /Users/gregjohnson/code/sula-mast-display
git rm appliance/backlight-sync.sh appliance/mast-backlight.service appliance/mast-backlight.timer
```

- [ ] **Step 3: Update `appliance/README.md`** — in the file table and any backlight prose, replace the `backlight-sync.sh`/`mast-backlight.*` (sun-based dimmer) entries with: `brightness-agent.sh` + `mast-brightness.service` (remote brightness via g5000 SSE) and `brightness-boot.sh` + `mast-brightness-boot.service` (boot-splash dimmer). Add a one-line "Brightness" section: set it from g5000's `/mast-config` slider; it persists and dims the boot screen; the panel floor prevents full black (`MAST_BACKLIGHT_MIN`).

- [ ] **Step 4: Verify**
Run: `cd /Users/gregjohnson/code/sula-mast-display && bash -n appliance/provision.sh && echo OK`
Confirm the three old files are gone: `ls appliance/ | grep -E "backlight-sync|mast-backlight" || echo "removed"`.

- [ ] **Step 5: Commit**
```bash
cd /Users/gregjohnson/code/sula-mast-display
git add appliance/provision.sh appliance/README.md
git commit -m "feat(appliance): provision brightness agent + boot dimmer; drop auto-dimmer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] g5000: `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0; `npx vitest run` → all pass (new DisplayConfig + brightness route tests included; pre-existing tile-proxy/SSE network tests fail in sandbox — ignore, they fail on develop too).
- [ ] g5000: `cd packages/web && npm run build` → succeeds.
- [ ] appliance: `bash -n` on all three scripts; `brightness-agent.sh --selftest` → `selftest OK`.
- [ ] Manual end-to-end on the live unit (recommended, not done by subagents): re-provision (or install the new units), move the `/mast-config` slider → panel dims within ~1 s; set low, reboot → splash comes up dim; pull g5000 → panel holds last brightness.

## Notes / non-goals (from the spec)
- Manual-only: the sun-based auto-dimmer is removed. Auto day/night could return later as a mode driving the same setter.
- N2K (future): decode the B&G dimming PGN in `@g5000/bridge` (sniff to identify it) → call `setDisplayConfig` (source-agnostic setter); later optionally transmit it. Out of scope here.
- Single global brightness (one display); per-display is a later refinement.
- g5000 deals only in 0–100 %; the appliance maps to hardware (floor `MAST_BACKLIGHT_MIN`, default 2/99 so it never goes fully black).
