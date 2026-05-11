# G5000 Plan 12 — Capture Wizards, Demo Mode, and Navbar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Three loosely-coupled UX wins.

1. **Navbar** across every page — Helm, Inspect, Devices, Polars, Sails, Wind/BSP/Compass/Boat, Autopilot all reachable in one click.
2. **BSP capture wizard** on `/calibration/bsp` — sail steady in still water, click Capture, the wizard records BSP + SOG for 30 s, computes `SOG/BSP` ratio, and writes it to the nearest BSP bin.
3. **Compass deviation capture wizard** on `/calibration/compass` — same shape: click Capture at a steady heading, record HDG + GPS COG for 30 s, deviation = `HDG_observed − COG` (modulo magvar), write to the nearest 10° bin.
4. **Demo mode** — `DEMO_MODE=1` env var on the autopilot-server starts a synthetic-data injector that publishes plausible wind/boat/motion samples on a loop. Closes the "we have no boat data yet" gap so the polar plot, helm dashboard, and capture wizards can all be visually validated bench-side. Replaces the "replay-driven validation" framing — we can validate without needing to have captured a real session yet.

**Architecture:**
- A new `Navbar.tsx` mounted in the root layout — server component, no SSE, just links.
- BSP and Compass wizards reuse the existing `useChannelHistory` rolling-buffer hook with a 30s window, same pattern as the tack-test wizard. Capture button kicks off a 30s timer; on completion, snap to nearest bin and PUT the updated cal.
- Demo injector lives in `apps/autopilot-server/src/demo-injector.ts`. Subscribes to nothing; publishes to the shared bus directly. Started conditionally based on `DEMO_MODE` env var. Writes to `wind.true.calibrated.*`, `wind.apparent.*`, `boat.speed.water`, `boat.heading.magnetic`, `nav.gps.cog`, `nav.gps.sog`, and the motion channels. When DEMO_MODE is on, the true-wind pipeline is skipped (otherwise it would overwrite the demo's `wind.true.calibrated.*` channels).
- Optional small "DEMO" chip on the navbar when in demo mode, so it's visually unambiguous that values aren't real.

**Tech stack additions:** none.

---

## Files

```
autopilot/
└── packages/
    └── web/
        └── src/app/
            ├── Navbar.tsx                                 NEW
            ├── layout.tsx                                  MODIFY: render <Navbar/>
            ├── calibration/
            │   ├── bsp/page.tsx                            MODIFY: add capture wizard
            │   └── compass/page.tsx                        MODIFY: add capture wizard
            └── api/dev/demo/route.ts                       NEW: GET status
└── apps/
    └── autopilot-server/
        └── src/
            ├── demo-injector.ts                            NEW
            └── index.ts                                    MODIFY: conditional demo wiring
```

---

## Task 1: Navbar

**Files:**
- Create: `packages/web/src/app/Navbar.tsx`
- Modify: `packages/web/src/app/layout.tsx`

### Step 1: `Navbar.tsx`

Server-rendered. Static list of routes. Highlights "current" via the existing `usePathname` hook (so it's a client component — fine).

```tsx
'use client';

import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/polars', label: 'Polars' },
  { href: '/sails', label: 'Sails' },
  { href: '/calibration/wind', label: 'Wind cal' },
  { href: '/calibration/bsp', label: 'BSP cal' },
  { href: '/calibration/compass', label: 'Compass' },
  { href: '/boat', label: 'Boat' },
  { href: '/autopilot', label: 'Autopilot' },
  { href: '/devices', label: 'Devices' },
  { href: '/inspect', label: 'Inspect' },
];

export function Navbar({ demoMode }: { demoMode?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <a href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </a>
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname?.startsWith(it.href + '/');
        return (
          <a
            key={it.href}
            href={it.href}
            className={`px-2 py-1 rounded ${
              active
                ? 'bg-amber-600 text-slate-900 font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {it.label}
          </a>
        );
      })}
      {demoMode && (
        <span className="ml-auto px-2 py-1 rounded bg-purple-700 text-purple-100 text-xs font-mono">
          DEMO
        </span>
      )}
    </nav>
  );
}
```

### Step 2: Mount in `layout.tsx`

Modify the root layout to render `<Navbar />` above `{children}`. The `demoMode` prop is read from a `/api/dev/demo` endpoint on the client (added in Task 4) — for now pass nothing (undefined).

```tsx
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

export const metadata: Metadata = { title: 'G5000', description: 'Performance instrument processor' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
```

### Step 3: Typecheck, commit

```bash
git add packages/web/src/app/Navbar.tsx packages/web/src/app/layout.tsx
git commit -m "feat(web): persistent Navbar across all pages"
```

---

## Task 2: BSP capture wizard

**File:** `packages/web/src/app/calibration/bsp/page.tsx` (modify)

Add a "Capture wizard" section below the existing manual editor. State machine: idle → capturing (5s) → reviewing → applied.

The wizard subscribes to `boat.speed.water` and `nav.gps.sog` via SSE + `useChannelHistory`. On Capture click, records 5 s, averages both, computes `ratio = SOG_avg / BSP_avg`, snaps to the nearest BSP bin (the bin whose centre is closest to BSP_avg), and shows the proposed change. Apply commits via PUT.

```tsx
// At top of file: import { useChannelHistory } from '../../../hooks/use-channel-history';
// Already importing useSse.

// In component body, after existing state:
const histBsp = useChannelHistory(channels.get('boat.speed.water'), 6000);
const histSog = useChannelHistory(channels.get('nav.gps.sog'), 6000);

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing'; startedAt: number }
  | { kind: 'reviewing'; bspAvg: number; sogAvg: number; binIdx: number; newMultiplier: number }
  | { kind: 'applied' };

const [capture, setCapture] = useState<CaptureState>({ kind: 'idle' });
const CAPTURE_MS = 5000;

const startCapture = () => {
  setCapture({ kind: 'capturing', startedAt: Date.now() });
  setTimeout(() => {
    const bsp = histBsp.average();
    const sog = histSog.average();
    if (bsp === null || sog === null || bsp <= 0.1 || sog <= 0.1) {
      setCapture({ kind: 'idle' });
      setErr('Capture failed: BSP and SOG samples must both be > 0.1 m/s');
      return;
    }
    if (!cal) return;
    // Snap to nearest bin
    let bestIdx = 0;
    let bestDist = Math.abs(cal.bins[0]! - bsp);
    for (let i = 1; i < cal.bins.length; i++) {
      const d = Math.abs(cal.bins[i]! - bsp);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    // New multiplier replaces the bin's current value (full replace; tack-test
    // style of accumulating delta would also work, but this is simpler and
    // matches "I just calibrated to this point").
    const newMultiplier = sog / bsp;
    setCapture({ kind: 'reviewing', bspAvg: bsp, sogAvg: sog, binIdx: bestIdx, newMultiplier });
  }, CAPTURE_MS);
};

const applyCapture = async () => {
  if (capture.kind !== 'reviewing' || !cal) return;
  const next: BspCal = {
    ...cal,
    multiplier: cal.multiplier.map((v, i) => (i === capture.binIdx ? capture.newMultiplier : v)),
  };
  setBusy(true);
  try {
    const res = await fetch('/api/config/bsp', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
    setCal(next);
    setCapture({ kind: 'applied' });
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
};
```

JSX section to add (after the existing manual editor, before the closing `</main>`):

```tsx
{cal && (
  <section className="border border-slate-700 rounded p-4 space-y-3 max-w-xl">
    <h2 className="text-lg font-semibold">Capture wizard</h2>
    <p className="text-xs text-slate-500">
      Sail steady in still water (no current) at a known speed. Click Capture
      to record 5s of BSP and GPS SOG; the wizard computes the multiplier and
      snaps to the nearest bin.
    </p>
    {capture.kind === 'idle' && (
      <button
        onClick={startCapture}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
      >
        Capture
      </button>
    )}
    {capture.kind === 'capturing' && (
      <p className="text-sm text-slate-300">Capturing… (5 s)</p>
    )}
    {capture.kind === 'reviewing' && (
      <div className="space-y-2 text-sm">
        <div className="text-slate-300">
          BSP avg: <span className="font-mono">{(capture.bspAvg * MS_TO_KNOTS).toFixed(2)} kn</span>
          <br />
          SOG avg: <span className="font-mono">{(capture.sogAvg * MS_TO_KNOTS).toFixed(2)} kn</span>
          <br />
          Bin selected: <span className="font-mono">{(cal.bins[capture.binIdx]! * MS_TO_KNOTS).toFixed(0)} kn</span>
          <br />
          New multiplier: <span className="font-mono">{capture.newMultiplier.toFixed(3)}</span>
          <br />
          (current: <span className="font-mono">{cal.multiplier[capture.binIdx]!.toFixed(3)}</span>)
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyCapture}
            disabled={busy}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button
            onClick={() => setCapture({ kind: 'idle' })}
            className="px-3 py-1 bg-slate-700 text-slate-200 rounded"
          >
            Discard
          </button>
        </div>
      </div>
    )}
    {capture.kind === 'applied' && (
      <div className="space-y-2">
        <p className="text-sm text-green-400">Applied.</p>
        <button
          onClick={() => setCapture({ kind: 'idle' })}
          className="px-3 py-1 bg-slate-700 text-slate-200 rounded"
        >
          Capture again
        </button>
      </div>
    )}
  </section>
)}
```

### Typecheck, commit

```bash
git add packages/web/src/app/calibration/bsp/page.tsx
git commit -m "feat(web): BSP capture wizard with GPS SOG correlation"
```

---

## Task 3: Compass deviation capture wizard

**File:** `packages/web/src/app/calibration/compass/page.tsx` (modify)

Same shape as the BSP wizard. Captures HDG + COG for 5 s, computes deviation, snaps to the heading-bin the boat is currently in. Includes magvar offset (read from boatConfig).

```tsx
// Imports add: useChannelHistory; type BoatConfig.

const [boat, setBoat] = useState<BoatConfig | null>(null);
useEffect(() => {
  fetch('/api/config/boat').then((r) => r.json()).then(setBoat).catch(() => {});
}, []);

const histHdg = useChannelHistory(channels.get('boat.heading.magnetic'), 6000);
const histCog = useChannelHistory(channels.get('nav.gps.cog'), 6000);

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing'; startedAt: number }
  | { kind: 'reviewing'; hdgAvg: number; cogAvg: number; binIdx: number; newDevRad: number }
  | { kind: 'applied' };

const [capture, setCapture] = useState<CaptureState>({ kind: 'idle' });
const CAPTURE_MS = 5000;

// Normalize an angle into [0, 2π) radians.
const norm = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x;
};

// Signed shortest-arc difference a-b in (-π, π].
const shortest = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

const startCapture = () => {
  setCapture({ kind: 'capturing', startedAt: Date.now() });
  setTimeout(() => {
    const hdg = histHdg.average();
    const cog = histCog.average();
    if (hdg === null || cog === null) {
      setCapture({ kind: 'idle' });
      setErr('Capture failed: need both HDG and COG samples');
      return;
    }
    // Bin selected by the current HDG (10° bins, 36 total).
    const binWidth = (2 * Math.PI) / 36;
    const binIdx = Math.min(35, Math.floor(norm(hdg) / binWidth));
    // Deviation = HDG_observed - HDG_true. HDG_true = COG (assuming no current).
    // Compass-magvar correction is applied by the cal already; this raw delta
    // captures the magnetic deviation only.
    const magvarRad = (boat?.magVarDeg ?? 0) * (Math.PI / 180);
    const newDevRad = shortest(hdg, cog - magvarRad);
    setCapture({ kind: 'reviewing', hdgAvg: hdg, cogAvg: cog, binIdx, newDevRad });
  }, CAPTURE_MS);
};

const applyCapture = async () => {
  if (capture.kind !== 'reviewing' || !cal) return;
  const next: CompassDeviation = {
    deviation: cal.deviation.map((v, i) => (i === capture.binIdx ? capture.newDevRad : v)),
  };
  setBusy(true);
  try {
    const res = await fetch('/api/config/compass-deviation', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
    setCal(next);
    setCapture({ kind: 'applied' });
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
};
```

JSX section (similar layout to BSP wizard):

```tsx
{cal && (
  <section className="border border-slate-700 rounded p-4 space-y-3 max-w-xl">
    <h2 className="text-lg font-semibold">Capture wizard</h2>
    <p className="text-xs text-slate-500">
      Sail steady on a single heading (no current). Click Capture to record
      5 s of compass HDG and GPS COG; deviation for the current heading bin
      is computed from their difference (with magvar from boat config).
    </p>
    {capture.kind === 'idle' && (
      <button
        onClick={startCapture}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
      >
        Capture
      </button>
    )}
    {capture.kind === 'capturing' && (
      <p className="text-sm text-slate-300">Capturing… (5 s)</p>
    )}
    {capture.kind === 'reviewing' && (
      <div className="space-y-2 text-sm">
        <div className="text-slate-300">
          HDG avg: <span className="font-mono">{(capture.hdgAvg * RAD_TO_DEG).toFixed(1)}°</span>
          <br />
          COG avg: <span className="font-mono">{(capture.cogAvg * RAD_TO_DEG).toFixed(1)}°</span>
          <br />
          Bin: <span className="font-mono">{capture.binIdx * 10}°–{capture.binIdx * 10 + 10}°</span>
          <br />
          New deviation: <span className="font-mono">{(capture.newDevRad * RAD_TO_DEG).toFixed(2)}°</span>
          <br />
          (current: <span className="font-mono">{(cal.deviation[capture.binIdx]! * RAD_TO_DEG).toFixed(2)}°</span>)
        </div>
        <div className="flex gap-2">
          <button onClick={applyCapture} disabled={busy} className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50">
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button onClick={() => setCapture({ kind: 'idle' })} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
            Discard
          </button>
        </div>
      </div>
    )}
    {capture.kind === 'applied' && (
      <div className="space-y-2">
        <p className="text-sm text-green-400">Applied.</p>
        <button onClick={() => setCapture({ kind: 'idle' })} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
          Capture again
        </button>
      </div>
    )}
  </section>
)}
```

### Typecheck, commit

```bash
git add packages/web/src/app/calibration/compass/page.tsx
git commit -m "feat(web): compass deviation capture wizard with GPS COG correlation"
```

---

## Task 4: Demo mode

**Files:**
- Create: `apps/autopilot-server/src/demo-injector.ts`
- Modify: `apps/autopilot-server/src/index.ts`
- Create: `packages/web/src/app/api/dev/demo/route.ts`

### Step 1: Demo injector

`demo-injector.ts`:

```ts
import type { Bus } from '@g5000/core';

const KN = 0.514444;
const DEG = Math.PI / 180;

/**
 * Periodically publish synthetic wind/boat/motion samples to the shared bus.
 * Used for bench-side visual validation of /helm, /polars, capture wizards,
 * etc. when no real boat hardware is available. The values aren't physically
 * consistent — TWS/TWA/BSP just oscillate independently — but they're
 * plausible enough to demo the UI.
 */
export function startDemoInjector(bus: Bus): () => void {
  const startedAt = Date.now();
  const id = setInterval(() => {
    const t = (Date.now() - startedAt) / 1000; // seconds since start
    // Slow TWS oscillation 8 ± 4 kn (period ~2 min)
    const twsKn = 8 + 4 * Math.sin(t / 20);
    const tws = twsKn * KN;
    // TWA sweeps 30°-150° (period ~1 min)
    const twaDeg = 90 + 60 * Math.sin(t / 10);
    const twa = twaDeg * DEG;
    // BSP roughly 70% of TWS at the current TWA (rough cat polar shape)
    const bspKn = twsKn * 0.7 * Math.sin(Math.abs(twa)) + 0.5;
    const bsp = bspKn * KN;
    // Slowly turning heading (one full rotation every 6 min)
    const hdgDeg = (t / 60) * 60;
    const hdg = ((hdgDeg % 360) + 360) % 360 * DEG;
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const pub = (channel: string, value: number, unit: string) => {
      bus.publish({
        channel,
        t_ns: now_ns,
        value: { kind: 'scalar', value, unit },
        source: 'demo',
      });
    };
    // Apparent wind — rough approximation, leaves visible numbers on /inspect.
    pub('wind.apparent.speed', tws + bsp * 0.4, 'm/s');
    pub('wind.apparent.angle', twa * 0.8, 'rad');
    // Calibrated true wind — published directly so the polar pipeline sees it
    // without needing the true-wind compute pipeline to run.
    pub('wind.true.calibrated.speed', tws, 'm/s');
    pub('wind.true.calibrated.angle', twa, 'rad');
    pub('wind.true.calibrated.direction', (hdg + twa + 2 * Math.PI) % (2 * Math.PI), 'rad');
    pub('boat.speed.water', bsp, 'm/s');
    pub('boat.heading.magnetic', hdg, 'rad');
    pub('nav.gps.cog', hdg + 0.03, 'rad');
    pub('nav.gps.sog', bsp + 0.08, 'm/s');
    pub('motion.heel', 0.08 * Math.sin(t / 7), 'rad');
    pub('motion.pitch', 0.03 * Math.cos(t / 5), 'rad');
    pub('motion.yaw', hdg, 'rad');
    pub('motion.rateOfTurn', 0.01, 'rad/s');
  }, 250);
  return () => clearInterval(id);
}
```

### Step 2: Wire into autopilot-server

In `apps/autopilot-server/src/index.ts`:

1. Add to imports: `import { startDemoInjector } from './demo-injector.js';`
2. Add env-var read near the others: `const DEMO_MODE = process.env.DEMO_MODE === '1';`
3. After the bridge starts but BEFORE the true-wind pipeline starts, if `DEMO_MODE` is true: start the demo injector and **skip** the true-wind pipeline (it would otherwise overwrite the demo's `wind.true.calibrated.*` samples). Polar pipeline still runs — it consumes the demo's true wind directly.

```ts
  if (DEMO_MODE) {
    const stopDemo = startDemoInjector(bus);
    teardown.push(async () => stopDemo());
    console.log('[autopilot] DEMO_MODE on — synthetic samples publishing to the bus');
  } else {
    // 4. True-wind compute pipeline ... (existing block, only when not demo)
    const stopCompute = await startTrueWindPipeline({ bus, configStore: store });
    teardown.push(stopCompute);
    console.log('[autopilot] true-wind compute pipeline online');
  }
```

The polar pipeline (block 4b) and TX wiring (block 5) stay outside the conditional.

### Step 3: `/api/dev/demo` endpoint

A simple GET that reports whether demo mode is on, so the Navbar can show the DEMO chip on the client:

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ demoMode: process.env.DEMO_MODE === '1' });
}
```

### Step 4: Navbar reads demo flag

Update `Navbar.tsx` to fetch `/api/dev/demo` on mount and show the DEMO chip when true. This is a Client Component already; add a `useEffect` + `useState`.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// ... ITEMS list unchanged

export function Navbar() {
  const pathname = usePathname();
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    fetch('/api/dev/demo')
      .then((r) => r.json())
      .then((j) => setDemoMode(Boolean(j.demoMode)))
      .catch(() => {});
  }, []);
  // ... rest unchanged
}
```

Remove the `demoMode?: boolean` prop from `Navbar`'s signature and from the layout call.

### Step 5: Typecheck, commit

```bash
git add apps/autopilot-server/src/demo-injector.ts apps/autopilot-server/src/index.ts packages/web/src/app/api/dev/demo/route.ts packages/web/src/app/Navbar.tsx
git commit -m "feat: DEMO_MODE synthetic-data injector + DEMO chip in navbar"
```

---

## Task 5: Final verification

- `npm test` (expect 126, no new tests)
- `npx tsc -b` clean
- `npm run lint`/`npm run format` if needed; commit
- Smoke (bench): boot `SKIP_BRIDGE=1 npm run dev` (without DEMO_MODE) — navbar shows on every route; /helm and /polars show `—` placeholders; capture wizards on bsp/compass show the Capture button but can't capture useful data (no live BSP/HDG flowing).
- Smoke (demo): boot `DEMO_MODE=1 SKIP_BRIDGE=1 npm run dev` — purple DEMO chip in navbar; /helm tiles populate with oscillating values; /polars operating-point dot moves around the plot; /calibration/bsp and /calibration/compass capture wizards now have live data and can run a fake capture cycle.
- Merge to main.

---

## Closing notes

After this plan:
- Navbar across every page; no more bouncing between URLs by hand.
- BSP and compass cal are usable end-to-end (manual entry already worked; wizards make the routine one-tap).
- `DEMO_MODE=1` lets us demo and visually test the whole stack — polar plot, helm dashboard, wizards — without any boat hardware. Closes the "we can't test the wizards without a session" loop.

Naturally next after this: actually take the boat trip and capture a real session. That session replays through the same SSE channels and serves as a regression-test bed for any future compute or visualization changes.
