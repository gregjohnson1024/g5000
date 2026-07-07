# Phase 0 — Guardrails & Plumbing (UI Overhaul)

Branch: `ui-overhaul` (off `develop`). **This entire phase must produce NO VISUAL CHANGE.**
Every task is independently committable. Scope is strictly the 6 deliverables below — no
token/theme/visual work (that is Phase 1).

## Hard constraints

- Read and never regress `docs/design/overhaul-keep-list.md`. Relevant here:
  - **Compact DMM** `33 42.232n 66 25.240w` (lowercase hemi glued to minute, no symbols) +
    paste-anything parser must stay byte-identical.
  - Ship every phase: app builds, passes baseline tests, is Pi-deployable at phase end.
- Web imports are **extensionless** (Turbopack/`next build --webpack`). Match existing style.
- ESM, strict TS (`noUncheckedIndexedAccess`), React 19, Next 16 App Router.
- Verification per task: `npm run typecheck`, `npm run test` (~4 known-baseline failures OK —
  routing/bermuda, web route tests needing ConfigStore, grib integration; anything else is a
  regression), `npm run lint`, and `npm run build --workspace @g5000/web`.

## Reference facts (from scout + file reads)

- `packages/web/src/lib/coords.ts` — canonical KEEP target. Has `parseCoordinate`,
  `parseLatLon`, `formatCoordinate` (with `'dmm'` = `41° 45.898' N`), types
  `ParsedCoord`/`FormatOptions`. Importers: `app/waypoints/page.tsx`,
  `app/routes/RouteBuilder.tsx`, `components/waypoint-form.ts`.
- `packages/web/src/lib/format-coords.ts` — DUPLICATE to fold in + delete. Exports `DmmParts`,
  `fmtLatDmm`, `fmtLonDmm`, `fmtLatLonDmm` (compact `33 42.232n`). 9 importers:
  `app/chart/page.tsx`, `app/log/client-view.tsx`, `app/anchor/panels/PositionPanel.tsx`,
  `app/passage/page.tsx`, `app/trips/client-view.tsx`, `app/helm/tile-helpers.ts`,
  `components/WaypointEditPopup.tsx`, `components/MobLayer.tsx`, `lib/friendly-source.ts`.
  **The two DMM string shapes DIFFER and BOTH must be preserved byte-identical.**
- `packages/web/src/hooks/use-sse.ts` — closest existing single-`/api/stream` consumer; good
  base to generalize (channel Map + `connected`). 4 `/api/stream` sites, 2 `/api/position`
  sites among 9 total `new EventSource(` sites.
- `/api/stream` route IGNORES `?channels=`; subscribes `**`. The store needs a **client-side
  channel selector** (do not change the server in Phase 0).
- Shell dup pollers to collapse (task 6 ONLY): `app/Navbar.tsx` (`fetch('/api/alarms')`
  @2000ms, computes count+topSeverity) and `components/AlarmBanner.tsx` (@2000ms, computes
  topAlarm+extraCount). Both mounted in `app/layout.tsx` (server component; children are
  client). Leave all other `/api/alarms` consumers (`AlarmAudio`, `MobLayer`,
  `alerts/active-list`, `chart/AnchorCard`) alone — later broad cutover.
- localStorage keys (20), two conventions (colon `chart:*` etc. + dot `g5000.*`). Cross-cutting:
  `chart:trackLayers` (chart↔tracks), `alarms:audio-enabled` (AlarmBanner↔AlarmAudio via window
  `CustomEvent`), `passage:tz` (through `lib/tz.ts`). Server `lib/persistence.ts` is `node:fs` —
  UNRELATED, leave it.
- No eslint anywhere — task 4 is a standalone node script + `lint:overhaul` npm script, exit 0.
- Internal `<a href="/...">` to convert (14 across 12 files) — inventory in task 1.
  KEEP `<a>`: `waypoints/page.tsx` `/api/waypoints/export-gpx` (has `download`).
  Already `<Link>`: `helm/SailRecommendationTile.tsx` (reference pattern).

---

## Task order (rationale)

Shared infra is created BEFORE its call sites are touched, so every task lands green:
coords module (2) and storage helper (3) before their consumers are repointed; usePoll +
SSE store (5) before the shell cutover (6). Link conversion (1) and the enforcement script
(4) are independent and can land anytime, but Link goes first because it is the lowest-risk,
purely-mechanical change and validates the no-visual-change discipline.

---

## Task 1 — Convert internal `<a href="/...">` to `next/link`

**Files (edit):**

- `packages/web/src/app/Navbar.tsx` — line ~196 brand `<a href="/">`; lines ~199–212 the
  nav-item `.map()` `<a href={it.href}>`. Keep all classes and `activeHref` logic identical.
- `packages/web/src/components/AlarmBanner.tsx` — the wrapping `<a href="/alerts">` (~68). It
  contains a nested `<button>` with `e.preventDefault()/stopPropagation()` in `toggleAudio`.
  `Link` renders an `<a>`, so the nested-button + stopPropagation pattern still works — verify
  the audio toggle click still does NOT navigate.
- `packages/web/src/app/chart/WindTimeline.tsx` — 2 `<a href="/forecast">` (~55, ~76).
- `packages/web/src/app/tide/page.tsx` — `<a href="/settings">` (~315).
- `packages/web/src/app/currents/page.tsx` — `<a href="/settings">` (~269).
- `packages/web/src/app/passage/page.tsx` — `<a href="/tracks">` (~245).
- `packages/web/src/app/polars/page.tsx` — `<a href="/sails">` (~87).
- `packages/web/src/app/helm/page.tsx` — `<a href="/sails">` (~61).
- `packages/web/src/app/autopilot/control-panel.tsx` — `<a href="/sniff">` (~162).
- `packages/web/src/app/sails/page.tsx` — `<a href="/sails/crossover">` (~154).
- `packages/web/src/app/sails/crossover/page.tsx` — `<a href="/sails">` (~88).
- `packages/web/src/app/helm/RaceMiniTimer.tsx` — `<a href="/race">` (~47).

Each: add `import Link from 'next/link';` (if absent), swap `<a href="/x" ...>`→`<Link href="/x" ...>`
and `</a>`→`</Link>`. Preserve every className/attribute/child.

**DO NOT touch:** `waypoints/page.tsx` `/api/waypoints/export-gpx` (`download` attr → stays `<a>`);
`SailRecommendationTile.tsx` (already `Link`). No mailto:/tel: exist in web src.

**Acceptance:** `grep -rn 'href="/' packages/web/src --include=*.tsx | grep '<a '` returns only
the export-gpx download anchor. Typecheck + web build green. Manual: nav clicks + AlarmBanner
audio toggle behave identically (toggle does not navigate).

---

## Task 2 — Merge coordinate libraries into one module

**Files:**

- Edit `packages/web/src/lib/coords.ts` — append the compact-DMM helpers folded from
  `format-coords.ts`: `DmmParts`, `fmtLatDmm`, `fmtLonDmm`, `fmtLatLonDmm`. Keep their
  implementations **byte-identical** (compact `33 42.232n` shape). Do NOT converge them with
  the existing `formatCoordinate('dmm')` shape (`41° 45.898' N`) — both shapes stay.
- Delete `packages/web/src/lib/format-coords.ts`.
- Repoint the 9 importers from `../lib/format-coords`/`../../lib/format-coords` (etc.) to the
  coords module: `app/chart/page.tsx`, `app/log/client-view.tsx`,
  `app/anchor/panels/PositionPanel.tsx`, `app/passage/page.tsx`, `app/trips/client-view.tsx`,
  `app/helm/tile-helpers.ts`, `components/WaypointEditPopup.tsx`, `components/MobLayer.tsx`,
  `lib/friendly-source.ts`. Keep extensionless import specifiers; only the module basename
  changes (`format-coords` → `coords`).

**Guard:** add/extend a colocated `packages/web/src/lib/coords.test.ts` (or add cases to an
existing coords test) asserting `fmtLatLonDmm(33.70387, -66.42067) === '33 42.232n 66 25.240w'`
and that `formatCoordinate(41.76497,'lat',{format:'dmm'})` still returns `41° 45.898' N`. This
locks BOTH shapes so the merge can't silently drift them.

**Acceptance:** `format-coords.ts` gone; `grep -rn "format-coords" packages/web/src` empty.
New coords test passes. Typecheck + web build green. No visual change (identical strings).

---

## Task 3 — Namespaced localStorage helper + one-time migration shim

**New file:** `packages/web/src/lib/storage.ts`

- Export a typed helper over a single namespace (prefix `g5000:`), e.g.
  `nsGet(key)`, `nsSet(key, value)`, `nsRemove(key)`, plus JSON variants
  (`nsGetJSON<T>`/`nsSetJSON`). SSR-safe (guard `typeof window`).
- Export `migrateLegacyStorage()`: idempotent, runs once (guarded by a
  `g5000:__migrated_v1` sentinel). For every legacy key found, copy its raw string value to the
  namespaced key IF the namespaced key is absent (no clobber, no data loss), then leave legacy
  keys in place (non-destructive — safe to re-run; a later phase can prune). Legacy keys to map
  (from scout inventory):
  - Colon-style: `chart:camera`, `chart:settings`, `chart:layers`, `chart:radar`,
    `chart:routeColorMode`, `chart:planState`, `chart:trackLayers`, `chart:follow`,
    `chart:orientation`, `ais:rangeNm`, `anchor:drawer`, `anchor:chainCounter`, `passage:tz`,
    `trips:state`, `shipLog:author`, `alarms:audio-enabled`.
  - Dot-style: `g5000.helm.group`, `g5000.race-audible.muted`, `g5000.audible-alarm.muted`.
  - Define a `LEGACY_KEY_MAP: Record<oldKey, newKey>` so the target names are explicit and
    reviewable; new namespaced names should be consistent (e.g. `g5000:chart.camera`).

**Wire migration once at shell mount:** add a tiny client component
`packages/web/src/components/StorageMigrationGate.tsx` (`'use client'`, calls
`migrateLegacyStorage()` in a `useEffect([])`, renders `null`) and mount it in
`app/layout.tsx` alongside `AlarmAudio`. This runs the shim before any screen reads storage on
a fresh load. **No call sites are repointed in this task** — existing screens keep reading their
legacy keys; the shim guarantees the namespaced copy exists for later phases. This keeps Phase 0
zero-risk (no behavior change) while establishing the primitive + migration.

**Test:** `packages/web/src/lib/storage.test.ts` — with a stubbed `localStorage`, seed a few
legacy keys, run `migrateLegacyStorage()` twice, assert namespaced copies exist, legacy values
untouched, second run is a no-op (sentinel set), and pre-existing namespaced values are never
overwritten.

**Acceptance:** storage test passes; typecheck + web build green; app boots with no visible
change (migration is invisible; existing screens still read legacy keys).

**Note:** do NOT route `passage:tz` writes through `lib/tz.ts` here — the shim just copies the
raw value; `lib/tz.ts` continues to own reads/writes for now.

---

## Task 4 — Enforcement scaffold (`lint:overhaul`, non-blocking)

**New file:** `scripts/lint-overhaul.mjs` (repo root `scripts/`). Standalone node script, NO
eslint. Scans `packages/web/src/**/*.tsx` (and `.ts` where relevant) and REPORTS (does not
fail) new-code violations:

- raw hex colors in TSX (`#rgb`/`#rrggbb` in className/style/string literals),
- `text-[9px]` / `text-[10px]` / `text-[11px]`,
- `window.confirm` / `window.alert` / `window.prompt` (and bare `confirm(`/`alert(`/`prompt(`),
- `new EventSource(` created outside the shared SSE store module (allowlist the store file +
  `hooks/use-sse.ts`),
- internal `<a href="/...">` (excluding `/api/` + `download` anchors).

Output a grouped, counted report to stdout. **Always `process.exit(0)`** (non-blocking; legacy
code violates these ~89/253/11×). Add a header note that Phase 7 flips this to blocking.

**Wire:** add to ROOT `package.json` scripts: `"lint:overhaul": "node scripts/lint-overhaul.mjs"`.

**Acceptance:** `npm run lint:overhaul` runs, prints counts, exits 0. Baseline counts roughly
match scout (hex ~253, tiny-text ~89, window.\* across ~11 files) minus the anchors/EventSource
this phase removed. Does not affect `npm run lint` (prettier) or CI gating.

---

## Task 5 — Shared data primitives: SSE store + `usePoll`

**New file:** `packages/web/src/hooks/use-poll.ts`

- `usePoll<T>(url, ms, opts?)` with a **module-level URL-keyed registry**: N callers of the
  same `url` (+ interval key) share ONE `setInterval` and ONE in-flight fetch; refcount on
  mount/unmount; tear down the interval when the last subscriber unmounts. Return
  `{ data, error, loading }` (latest shared result) and re-render subscribers on new data.
  SSR-safe. Keep semantics compatible with the existing Navbar/AlarmBanner poll (fetch JSON,
  swallow transient errors).

**New file (SSE store):** `packages/web/src/components/SseStoreProvider.tsx` (+ `use-sse-store.ts`
hook if cleaner). Generalize `hooks/use-sse.ts` into ONE provider owning a **single**
`EventSource('/api/stream')` for the whole app:

- expose `channels` (latest `JsonSafeSample` per channel), `connected`/link state, and
  **`lastSampleAt` per channel** (timestamp map, for staleness — a Phase-1 keep-list need).
- expose a **client-side channel selector** hook (e.g. `useChannel(name)` /
  `useChannels(pattern)`), since `/api/stream` ignores `?channels=` and streams `**`.
- Do NOT rip out the 9 existing EventSource sites now — this task only ADDS the primitive and
  provider (mount the provider in `layout.tsx`). Broad consumer cutover is later phases.

**Test (required):** `packages/web/src/hooks/use-poll.test.ts` — using fake timers + a mocked
`fetch`, mount two `usePoll(sameUrl, 2000)` consumers and assert only ONE interval/fetch cycle
serves both (dedupe); unmount one and assert the interval keeps running for the survivor;
unmount the last and assert the interval is cleared. Cover a second distinct URL runs its own
interval.

**Acceptance:** use-poll test passes (proves refcount/dedupe). Typecheck + web build green.
Provider mounted but not yet consumed by screens beyond task 6 → no visual change.

---

## Task 6 — Cut the shell's duplicate `/api/alarms` pollers to `usePoll`

Reference adoption ONLY. Both `Navbar.tsx` and `AlarmBanner.tsx` independently poll
`/api/alarms` @2000ms. Replace both hand-rolled `useEffect`+`setInterval` blocks with a shared
`usePoll('/api/alarms', 2000)` so ONE interval serves both.

**Files:**

- `packages/web/src/app/Navbar.tsx` — remove the poll `useEffect` (~147–172) and its
  `alarmCount`/`topSeverity` state; derive `alarmCount` + `topSeverity` from `usePoll` data
  (compute the same rank reduction). Keep the badge rendering pixel-identical.
- `packages/web/src/components/AlarmBanner.tsx` — remove the poll `useEffect` (~24–45) and its
  `topAlarm`/`extraCount` state; derive from the same `usePoll('/api/alarms', 2000)` data
  (same sort + `extraCount = max(0, len-1)`). Keep the audio-toggle + `AUDIO_TOGGLE_EVENT`
  behavior and the `if (!topAlarm) return null` short-circuit unchanged.

Both components are already client and both mount under `layout.tsx`, so a module-level
`usePoll` registry naturally collapses them to one interval.

**Leave untouched:** all other `/api/alarms` consumers (`AlarmAudio`, `MobLayer`,
`alerts/active-list`, `chart/AnchorCard`) — later broad cutover, out of Phase 0 scope.

**Acceptance:** In-browser, `/api/alarms` is fetched once per 2 s while both nav badge and
banner are mounted (verify via network panel: one request per tick, not two). Badge + banner
render identically to before (no visual change). Typecheck + test + lint + web build green.

---

## Phase-0 exit checklist

- `npm run typecheck` clean.
- `npm run test` = only the ~4 known-baseline failures (no new reds); new coords/storage/
  use-poll tests green.
- `npm run lint` (prettier) clean; `npm run lint:overhaul` runs + exits 0.
- `npm run build --workspace @g5000/web` succeeds.
- Manual smoke: nav + AlarmBanner unchanged; a single `/api/alarms` poll serves the shell;
  no visual difference anywhere.
