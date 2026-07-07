# G5000 UI Overhaul — Phase 3: Primitive wave & safety redesign

**Branch:** `ui-overhaul`
**Date:** 2026-07-06
**Proposal:** `docs/design/g5000-ui-overhaul-proposal.md` §5 (Component library — Tier 1),
§4.4/§4.5 (targets, radius), §7.12 (Alerts → Takeover), §8 (marine specifics).
**Keep-list (law):** `docs/design/overhaul-keep-list.md`.

## Goal

Build the Tier-1 primitive library (token-based, in `packages/web/src/components/ui/`) by
**extracting** each primitive from its named best-in-app seed (never inventing where a seed
exists), then run the safety wave: wire `StalenessShroud` onto the `/sail` helm + `/sail/autopilot`
readouts, add a `Takeover` for the CRITICAL alarm tier (anchor-drag + MOB) fed by the Phase-2
`AlarmStore`, retire the `window.confirm/alert/prompt` sites through `ConfirmDialog`/`Dialog`,
fix the `LinePingPanel` port/stbd colour inversion, and guard the race Reset.

**Phase gate (proposal §9 Phase 3):** pull the YDWG cable — every helm value visibly stales
within 10s and the shell declares LINK LOST. App builds, every route resolves, baseline tests
still ~7-fail/rest-green.

## Hard constraints (from the keep-list — do not regress)

- **Tokens only.** Every primitive uses semantic Tailwind utilities that map to CSS vars
  (`bg-surface`, `text-ink`, `border-hairline`, `text-accent`, `text-danger`, `text-port`,
  `text-stbd`, `bg-scrim`, …). A raw hex literal in a `.tsx` fails review. Confirmed exposed via
  `@theme inline` in `globals.css`: surface/surface-raised/surface-sunken, ink/ink-2/ink-3/ink-4/
  ink-value, hairline/hairline-strong, accent(+hi/ink/strong/dim-bg), on-accent, focus, ok/warn/
  info/danger/danger-strong/danger-surface, port/stbd, live/stale/demo/replay, scrim.
  **NOT exposed as utilities:** the radius tokens (`--r-control`/`--r-panel`/`--r-sheet`/
  `--r-badge` exist only as raw CSS vars). Primitives may use `rounded-md`/`rounded-lg` (Phase
  1/2 precedent) OR add `--radius-control`/`--radius-panel`/`--radius-sheet`/`--radius-badge` to
  the `@theme` block to unlock `rounded-control`/`rounded-panel`/etc. — decide once in Task 1 and
  apply uniformly. The r-\* token names are the proposal's end state.
- **MOB stays hold-with-progress** (never a bare key / single click). `components/MobButton.tsx`
  is the canonical seed (HOLD_MS=800, rAF fill, `onPointerDown`/`Up`/`Leave`, `onContextMenu`
  preventDefault, fires only on full hold, ✓ only on `res.ok`).
- **AP defense-in-depth** (env → capability → confirm → cooldown → ack log) unchanged.
- **Race:** sync-to-gun optimistic snap intact (`RaceTimer.tsx` Sync button, do not touch);
  Reset guarded.
- **Silence-based Navico clearing** preserved (ack path = `PATCH /api/alarms {id, action:'ack'}`).
- **Port/stbd marine-correct** (PORT=RED, STBD=GREEN); **NIGHT encodes P/S by shape+glyph, not
  hue** (NIGHT maps both port/stbd to red-family). The existing "Ping Port End"/"Ping Stbd End"
  word labels satisfy the glyph requirement, so a token swap is night-safe.
- **Offline-honest empty states:** `—` in a reserved min-height slot, never a fake 0 or a frozen
  live value.
- **aria/role habits:** `aria-pressed` on segmented controls, `role=radio`/`role=group`,
  focus rings for the Pi mouse+keyboard.
- **UTC / mono / tabular numerals** globally.

## Test-harness reality (drives every task's test)

`packages/web` has **NO jsdom / @testing-library/react** (confirmed: `RadarOverlay.test.tsx`
only asserts the export is a function; vitest runs the default node environment via root
`vitest.config.ts`). Therefore **component render tests are not possible** — every primitive's
testable logic must be factored into a **pure, exported helper** (state machine, timing math,
token/kind mapping) and unit-tested directly. Primitives without logic get a smoke test asserting
the export shape. This is a design instruction, not a nicety: e.g. `StalenessShroud`'s state
machine → `stalenessState(ageMs)` pure fn; `HoldButton`'s fire condition → the progress-fraction
math; port/stbd → a `portStbdToken(end)` map.

## Where the seeds and wiring live (verified)

| Primitive                | Seed file (extract from)                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`                  | `packages/web/src/app/anchor/panels/DepthPanel.tsx` (card grammar `bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]`; header voice `text-xs uppercase tracking-wide text-slate-500 font-medium`)          |
| `InstrumentTile`         | `packages/web/src/app/sail/HelmTile.tsx` (label/value/unit?/severity('good'\|'ok'\|'bad'\|'neutral')/sub?/small?/children?; value `text-6xl`/`text-4xl` font-mono; severity→colour map)                                                        |
| `StatusChip`             | `packages/web/src/components/StatusBadge.tsx` (visual recipe `text-xs px-2 py-1 border rounded` + tinted `bg-<c>/20 … border-<c>-700`; **extract the visual only — leave its `/api/wardrobe/active` poll behind**)                             |
| `HoldButton`             | `packages/web/src/components/MobButton.tsx` (HOLD_MS=800 rAF; the canonical hold-with-progress seed used by NavShell)                                                                                                                          |
| `SegmentedControl`       | `packages/web/src/app/sail/HelmTabs.tsx` (`aria-pressed`, grid) + `packages/web/src/components/TzToggle.tsx` (`role='group'`, inline-flex) — merge to ONE impl                                                                                 |
| `Button`/`IconButton`    | no single seed — synthesize from tokens (primary=accent fill, secondary=hairline-strong outline, ghost, danger=danger-strong; md 44px / sm 36px work-only)                                                                                     |
| `Field` family           | `Input`/`Select`/`Toggle`/`Range` — synthesize per §5 recipe (sunken well, hairline border, r-control, 44px, focus ring); `CoordField` parser lifted verbatim from `lib/coords` (deferred to a Field-heavy phase unless trivially needed here) |
| `Dialog`/`ConfirmDialog` | no seed — synthesize (focus trap, Escape, names the record)                                                                                                                                                                                    |
| `Toast`                  | no seed — WORK surfaces only                                                                                                                                                                                                                   |
| `Takeover`               | no seed — synthesize full-viewport `e3`, red-keyed every theme (`bg-scrim`), one primary action + hold-to-silence                                                                                                                              |

**StalenessShroud data source:** two ways, both confirmed. (1) `SseStoreProvider.tsx` exposes
`lastSampleAt: ReadonlyMap<string,number>` (Unix-ms) via `useSseStore()` / `useSseChannel(name)`
in `hooks/use-sse-store.ts`. (2) every `JsonSafeSample` carries `t_ms` (`packages/core/src/
json-safe.ts`), so `age = Date.now() - sample.t_ms` works without the store. **Mismatch to
respect:** `app/sail/page.tsx`→`CoreStrip.tsx` and `autopilot/readonly-view.tsx` currently use
the OLDER `useSse()` (`hooks/use-sse.ts`) which returns `{channels, connected}` **without**
`lastSampleAt`. Lowest-risk wiring = read age from each sample's own `t_ms` (no hook cutover).
`readonly-view.tsx` already has an inline `age(s)` = `(Date.now()-s.t_ms)/1000` helper — that is
exactly the logic `StalenessShroud` generalizes; replace it.

**Core /sail channels to shroud** (from `CoreStrip.tsx`): `nav.gps.sog`, `boat.heading.true`/
`boat.heading.magnetic` (+`nav.magvar`), `nav.gps.cog`/`nav.gps.cog.magnetic`, `nav.depth`,
`wind.true.speed`, `wind.true.direction`. **AP readouts** (`readonly-view.tsx`): `autopilot.mode`,
`autopilot.target.heading`, `autopilot.target.track`, `autopilot.commandedRudder`,
`autopilot.actual.heading`, `boat.heading.magnetic`.

**StalenessShroud state machine (§5 / keep-list):** fresh `<2s` → render normal · aging `2–10s`
→ dim numerals to `--ink-3` · stale `>10s` → hollow numerals + show age chip · transport link-loss
(`SseStore.connected===false`) → shell shows LINK LOST (NavShell link LED — already Phase-2; the
shroud just must not paper over a dead link with a stale-but-styled number).

**AlarmStore / Takeover wiring:** `components/AlarmStore.tsx` runs one `usePoll('/api/alarms',
2000)`; `useAlarms()` returns `{ active: AlarmRow[], topSeverity, count }`; `SEVERITY_RANK`
CRITICAL=3/WARN=2/INFO=1. **CRITICAL trigger set for the Takeover:** any active row with
`severity==='CRITICAL' && id ∈ {'mob','anchor-watch'}`. Silence path = `PATCH /api/alarms {id,
action:'ack'}`. **Gap to close:** `AlarmRow` currently drops `context`; the registry's
`AlarmSnapshot` (`packages/core/src/alarms.ts`) carries `context?: Record<string,unknown>`
(MOB fires with `{lat,lon,t}`; anchor-watch label already reads `Anchor drag <n> m`). If the
Takeover needs MOB coords / drag distance in its giant statement, extend `AlarmRow` + the
`AlarmStore` mapping to pass `context` through (the `/api/alarms` GET already returns it via
`registry.active()`). **Provider tree:** `layout.tsx` order is `SseStoreProvider > ThemeStoreProvider

> ThemeController > AlarmStore > (AlarmAudio, NavShell, children)`. A `Takeover`consuming`useAlarms()`must mount **inside`<AlarmStore>`** — as a sibling of `NavShell`.

**window-dialog sites (deliverable 4, authoritative from `npm run lint:overhaul`, 14 total):**
`app/boat/crossover/page.tsx:38`; `app/boat/diag/sessions/page.tsx:98`;
`app/boat/polars/PolarHeatmap.tsx:81,90,94,107,111`; `app/boat/sails/page.tsx:44,57,74`;
`app/boat/setup/profile/page.tsx:151` (window.confirm); `app/sail/race/LinePingPanel.tsx:56`
(alert 'No GPS position available'); `app/voyage/logbook/client-view.tsx:233` (window.confirm
'Delete this trip?'); `app/voyage/plan/page.tsx:129` (window.confirm `Delete waypoint ${id}?`).
**Scope decision (this plan):** route the **three destructive `window.confirm` sites**
(profile/151, logbook/233, plan/129) + the **LinePingPanel alert** through `ConfirmDialog`/
`Dialog`. The `boat/*` validation `alert()`s are better as inline field errors/Toast (WORK
surfaces) and are **out of scope for Phase 3** — leave a note; they migrate with their forms in
Phase 4+. `plan.tsx`/`logbook` confirms **name the record, not the id** ("Delete waypoint BR-4?").

**Race port/stbd inversion (deliverable 5):** `app/sail/race/LinePingPanel.tsx` line 94 "Ping
Port End" uses `bg-emerald-700` (GREEN — wrong); line 106 "Ping Stbd End" uses `bg-rose-700`
(RED — wrong). Swap so Port→`bg-port`/port token, Stbd→`bg-stbd`/stbd token. Same file's line 56
`alert()` is the LinePingPanel confirm-site above.

**Race Reset guard (deliverable 6):** `app/sail/race/RaceTimer.tsx` lines 146–152 — bare
`<button onClick={() => void post({action:'reset'})}>` styled `bg-red-800`, no confirmation.
Guard with `ConfirmDialog` (or a `HoldButton` per §5). **Do not touch the Sync button (line 113)
or the ±min/±s buttons** — sync-to-gun optimistic snap must stay intact.

**MOB duplication trap:** there are TWO MobButtons. `components/MobButton.tsx` = GOOD
hold-with-progress (the `HoldButton` seed, used by NavShell). `app/sail/MobButton.tsx` = a
click→white-confirm-modal that also fires on a bare `m` key — **both keep-list violations** (MOB
must be hold, never a single click / bare key). NavShell already carries the shell MOB. Phase 3
should **drop `app/sail/MobButton.tsx` (and its bare-key handler in `app/sail/page.tsx:78`)** since
the shell already provides the hold-based MOB. Do not re-implement a second MOB.

---

## Tasks (ordered)

### Task 1 — Core primitives: Panel, StatusChip, Button, IconButton, SegmentedControl

**Files:**

- `packages/web/src/components/ui/Panel.tsx` (new) — extract from `anchor/panels/DepthPanel.tsx`.
  Header (label voice + optional `StatusChip` slot + optional 44px action) / body / footer;
  variants `default · hero · alarm` (alarm = `--danger-strong` border + tinted header); built-in
  `EmptyState` (`—` in a reserved min-height slot + honest reason line). Tokens only
  (`bg-surface border-hairline`, header `text-ink-2 uppercase tracking-wide`).
- `packages/web/src/components/ui/StatusChip.tsx` (new) — extract the **visual recipe only** from
  `components/StatusBadge.tsx` (leave the `/api/wardrobe/active` poll behind). Kinds:
  `ok|warn|alarm|info|neutral|live|stale|demo|replay|armed`; `live` pulses (≤1Hz), `stale` shows
  an age; retokenize to `bg-<token>/20` + border + ink.
- `packages/web/src/components/ui/Button.tsx` (new) — `Button` (primary=accent fill /
  secondary=hairline-strong outline / ghost / danger=danger-strong; md 44px, sm 36px work-only;
  focus ring `--focus`) + `IconButton` (44px hit, Lucide icon).
- `packages/web/src/components/ui/SegmentedControl.tsx` (new) — merge `sail/HelmTabs.tsx` +
  `components/TzToggle.tsx` into ONE impl. Selected = accent fill (DAY/SUN) / red outline (NIGHT
  via tokens, no theme branch); keep `aria-pressed` + `role=radio`/`role=group`.
- `packages/web/src/components/ui/index.ts` (new) — barrel export.
- `packages/web/src/components/ui/status-chip-kind.ts` (new) — pure `kind → {bg,border,ink,pulse}`
  token-class map (testable).
- `packages/web/src/components/ui/status-chip-kind.test.ts` (new).

**Decide-once:** whether to add `--radius-*` to `@theme` (unlocking `rounded-control`/`rounded-panel`)
or stay on `rounded-md`/`rounded-lg`. Apply the same choice to every Task in this plan.

**Acceptance:** all four primitives export from `components/ui/index.ts`; each renders with tokens
only (grep the folder for a `#` hex → zero hits); `SegmentedControl` sets `aria-pressed` on the
active segment; `Panel` `alarm` variant uses `border-danger-strong`; `StatusChip` supports all 10
kinds. `npm run typecheck` + `npm run lint` green.
**Test:** `status-chip-kind.test.ts` asserts each of the 10 kinds maps to token classes (no raw
hex), `live`→pulse true, `stale`→pulse false, and every returned class string references a
`-token` (not `slate-`/`rose-`/`emerald-`).

---

### Task 2 — HoldButton + Dialog/ConfirmDialog + Toast

**Files:**

- `packages/web/src/components/ui/HoldButton.tsx` (new) — extract the hold-with-progress mechanism
  from `components/MobButton.tsx`. Generalize: `holdMs` prop (600–1500, default 800), `onHold`
  callback (fires only on full hold), radial/linear fill, `label`/`children`, `onPointerDown`/
  `Up`/`Leave` + `onContextMenu` preventDefault. Keep the "✓ only on success" pattern optional via
  a `confirmed` prop. Tokens only.
- `packages/web/src/components/ui/hold-progress.ts` (new) — pure `holdFraction(elapsedMs, holdMs)`
  - `isComplete(fraction)` timing helpers (testable without rAF).
- `packages/web/src/components/ui/hold-progress.test.ts` (new).
- `packages/web/src/components/ui/Dialog.tsx` (new) — `Dialog` (focus trap, Escape-to-close,
  `bg-scrim` backdrop `e3`, `role=dialog`/`aria-modal`, restores focus on close) + `ConfirmDialog`
  (title, message that **names the record**, `danger` variant, Cancel + Confirm; Confirm may be a
  `HoldButton` when `hold` prop set). No `window.confirm`.
- `packages/web/src/components/ui/Toast.tsx` (new) — bottom-center, `ok|alarm|info`, optional
  action slot; **WORK surfaces only** (documented in the file header — never mount on a glance
  surface, never cover a numeral).
- Update `packages/web/src/components/ui/index.ts` barrel.

**Acceptance:** `HoldButton` fires `onHold` only after a full `holdMs` hold and cancels on
pointer-up/leave (verified via the pure helper + a smoke test on the export); `ConfirmDialog`
traps focus, closes on Escape, and renders the record name passed in; tokens only across all three
files. `typecheck` + `lint` green.
**Test:** `hold-progress.test.ts` — `holdFraction(0,800)===0`, `holdFraction(400,800)===0.5`,
`holdFraction(800,800)>=1`, `isComplete(1)===true`, `isComplete(0.99)===false`; plus a smoke test
that `HoldButton`/`Dialog`/`ConfirmDialog`/`Toast` export functions.

---

### Task 3 — InstrumentTile with built-in StalenessShroud

**Files:**

- `packages/web/src/components/ui/StalenessShroud.tsx` (new) — wraps a value; reads age from a
  passed `t_ms` (or `ageMs`) prop; applies the state machine styling (fresh normal / aging dim to
  `text-ink-3` / stale hollow + age chip). Re-renders on a ~1s tick so a value crosses thresholds
  live. Renders `—` in a reserved slot when the value is absent.
- `packages/web/src/components/ui/staleness.ts` (new) — pure
  `stalenessState(ageMs): 'fresh'|'aging'|'stale'` (thresholds 2000/10000) +
  `stalenessClasses(state)` → token classes + `ageLabel(ageMs)` (e.g. `12s`).
- `packages/web/src/components/ui/staleness.test.ts` (new).
- `packages/web/src/components/ui/InstrumentTile.tsx` (new) — extract from `sail/HelmTile.tsx`
  (preserve `label/value/unit/severity/sub/small/children` API); grow to `size d1–d4`, a **3px
  severity left edge** (D3), and a **built-in `StalenessShroud`** (accepts an optional `t_ms`/
  `ageMs`; when provided, the value is shrouded). Slot-stable: reserves space, renders `—` when
  `value` is absent. Tokens only (severity map → `text-ok`/`text-accent`/`text-danger`/`text-ink`).
- Update barrel.

**Acceptance:** `InstrumentTile` matches `HelmTile`'s API surface (drop-in for its consumers:
`CoreStrip.tsx`, `groups/*Group.tsx`) plus the new `size`/`ageMs` props; a tile with a `t_ms`
older than 10s renders hollow numerals + an age chip; a tile with no `value` renders `—` in a
fixed-height slot. Tokens only. `typecheck` + `lint` green.
**Test:** `staleness.test.ts` — `stalenessState(500)==='fresh'`, `1000`→fresh, `3000`→'aging',
`9999`→'aging', `10001`→'stale'; `stalenessClasses('aging')` includes `text-ink-3`;
`stalenessClasses('stale')` marks hollow; `ageLabel(12345)` renders a compact `12s`.

---

### Task 4 — Wire StalenessShroud onto /sail helm + /sail/autopilot

**Files:**

- `packages/web/src/app/sail/CoreStrip.tsx` (edit) — replace `HelmTile` usage with
  `InstrumentTile`, passing each core channel's sample `t_ms` so the shroud is live. Channels:
  `nav.gps.sog`, `boat.heading.true`/`.magnetic`(+`nav.magvar`), `nav.gps.cog`/`.magnetic`,
  `nav.depth`, `wind.true.speed`, `wind.true.direction`. Lowest-risk: keep `useSse()`, read
  `age = Date.now() - sample.t_ms` from each sample (no hook cutover).
- `packages/web/src/app/sail/groups/StartingGroup.tsx`,
  `packages/web/src/app/sail/groups/NavigatingGroup.tsx`,
  `packages/web/src/app/sail/groups/PerformanceGroup.tsx` (edit) — swap `HelmTile`→`InstrumentTile`
  (staleness on the live tiles).
- `packages/web/src/app/sail/autopilot/readonly-view.tsx` (edit) — replace the inline `age(s)`
  helper + the raw `text-3xl font-mono` readouts with `InstrumentTile`/`StalenessShroud` for
  `autopilot.mode`, `autopilot.target.heading`, `autopilot.target.track`,
  `autopilot.commandedRudder`, `autopilot.actual.heading`, `boat.heading.magnetic`. Preserve the
  AP defense-in-depth text and the `apTxEnabled` listen-only note verbatim.
- Optionally delete `packages/web/src/app/sail/HelmTile.tsx` once all consumers migrate (or leave
  a thin re-export; prefer deletion to avoid two grammars).

**Acceptance (phase gate):** with the app running and the source going stale (or the YDWG cable
pulled), every `/sail` core value and every `/sail/autopilot` readout visibly stales within 10s
(dims 2–10s, hollows >10s with an age chip); a frozen number never looks live; the shell LINK LED
declares LINK LOST on transport loss. No layout shift when a value stales (reserved slots).
`typecheck` + `lint` + `next build` green; `/sail` and `/sail/autopilot` render.
**Test:** the shroud logic is already covered by `staleness.test.ts` (Task 3); add no new render
test (harness can't). Manual/emulator verification is the gate.

---

### Task 5 — Takeover + AlarmStore critical wiring (anchor-drag + MOB)

**Files:**

- `packages/web/src/components/AlarmStore.tsx` (edit) — extend `AlarmRow` with an optional
  `context?: Record<string, unknown>` and pass it through in the `usePoll` mapping (the GET
  already returns `registry.active()` snapshots carrying `context`). Add a derived
  `criticalTakeover: AlarmRow | null` selector (highest-severity active row where
  `severity==='CRITICAL' && id ∈ {'mob','anchor-watch'}`), or expose a small helper the Takeover
  computes from `active`.
- `packages/web/src/components/ui/Takeover.tsx` (new) — full-viewport `e3`, `bg-scrim`,
  **red-keyed in every theme** (use `--danger`/`--danger-strong` tokens which are red in all three
  palettes — do NOT branch on theme). Giant statement (`d1`) from the alarm label + `context`
  (MOB position in compact DMM / anchor-drag distance). One **primary action** (Go to alarm / view)
  - a **hold-to-silence** `HoldButton` that `PATCH /api/alarms {id, action:'ack'}` with the alarm's
    id. MOB keeps its hold-with-progress arm (the silence is the hold here).
- `packages/web/src/components/ui/takeover-trigger.ts` (new) — pure
  `pickCriticalTakeover(active: AlarmRow[]): AlarmRow | null` (id∈{mob,anchor-watch} && CRITICAL,
  highest-ranked first). Testable.
- `packages/web/src/components/ui/takeover-trigger.test.ts` (new).
- `packages/web/src/app/layout.tsx` (edit) — mount `<Takeover/>` **inside `<AlarmStore>`** (sibling
  of `NavShell`, before/after `children`) so it consumes `useAlarms()`.

**Acceptance:** when an active CRITICAL `mob` or `anchor-watch` alarm exists, the Takeover covers
the viewport with a red-keyed statement + one primary action + a hold-to-silence that PATCHes ack;
holding silence removes the row and dismisses the Takeover; the Takeover is red in DAY/NIGHT/SUN
(tokens, no theme branch). A WARN/INFO alarm never triggers a Takeover. `typecheck` + `lint` +
`next build` green.
**Test:** `takeover-trigger.test.ts` — MOB CRITICAL → returns it; anchor-watch CRITICAL → returns
it; anchor-watch WARN → null; a CRITICAL non-{mob,anchor-watch} id → null; two criticals → returns
the top-ranked; empty → null.

---

### Task 6 — Retire destructive window.confirm sites via ConfirmDialog

**Files:**

- `packages/web/src/app/voyage/plan/page.tsx` (edit) — replace the line-129 `window.confirm(
\`Delete waypoint ${id}?\`)`with a`ConfirmDialog` that **names the waypoint** ("Delete waypoint
  BR-4?", not by id), danger variant.
- `packages/web/src/app/voyage/logbook/client-view.tsx` (edit) — replace the line-233
  `window.confirm('Delete this trip? This cannot be undone.')` with a `ConfirmDialog` naming the
  trip, danger variant.
- `packages/web/src/app/boat/setup/profile/page.tsx` (edit) — replace the line-151 `window.confirm`
  with a `ConfirmDialog`.
- **Out of scope (note in the plan/PR, do not touch here):** the `boat/*` validation `alert()`s
  (crossover/38, diag/sessions/98, polars ×5, sails ×3) — these are validation messages destined
  for inline field errors / Toast when their forms migrate in Phase 4+.

**Acceptance:** `npm run lint:overhaul`'s window-dialog count drops by the three destructive
confirms (+ the LinePingPanel alert handled in Task 7) — i.e. the three `window.confirm` sites are
gone; each replacement names the record, not the id; Escape/Cancel aborts the delete; Confirm
performs it. `typecheck` + `lint` + `next build` green; `/voyage/plan`, `/voyage/logbook`,
`/boat/setup/profile` render.
**Test:** no unit test (UI-only, no extractable logic); rely on `lint:overhaul` count + build.

---

### Task 7 — Fix LinePingPanel port/stbd inversion + guard race Reset + drop sail MOB

**Files:**

- `packages/web/src/app/sail/race/LinePingPanel.tsx` (edit) — (a) swap the inverted colours: "Ping
  Port End" (line 94) `bg-emerald-700` → port token (`bg-port`/`text-port`); "Ping Stbd End" (line 106) `bg-rose-700` → stbd token (`bg-stbd`/`text-stbd`). NIGHT-safe because the word labels carry
  the P/S glyph. (b) Replace the line-56 `alert('No GPS position available')` with a `ConfirmDialog`
  or an inline `Toast`/message (WORK-ish, but a `Dialog`/inline error is fine — no `window.alert`).
- `packages/web/src/app/sail/race/RaceTimer.tsx` (edit) — guard the line-146 Reset button with a
  `ConfirmDialog` (or convert to a `HoldButton` per §5). **Leave the Sync button (line 113) and
  ±min/±s buttons untouched** (sync-to-gun optimistic snap invariant).
- `packages/web/src/app/sail/MobButton.tsx` (delete) + `packages/web/src/app/sail/page.tsx` (edit)
  — remove the click→white-modal sail MOB and its bare-`m`-key handler (keep-list: MOB is
  hold-with-progress, never a bare key / single click). NavShell's shell MOB already covers it.
  Remove the now-dead import/mount.

**Acceptance:** on `/sail/race`, Port End renders RED (port token), Stbd End renders GREEN (stbd
token) in DAY/SUN and red-family-by-shape in NIGHT; the "No GPS" path no longer calls
`window.alert`; the Reset button prompts a confirm (or requires a hold) before clearing the timer;
`app/sail/MobButton.tsx` is gone and the bare-`m` fire is removed; `npm run lint:overhaul` shows
the LinePingPanel alert retired. `typecheck` + `lint` + `next build` green; `/sail` and
`/sail/race` render.
**Test:** `packages/web/src/app/sail/race/line-ping-token.test.ts` (new) — a tiny pure
`portStbdToken(end: 'port'|'stbd')` helper factored out of the panel, asserting
`portStbdToken('port')` maps to the port token class and `('stbd')` to the stbd token class
(guards against a future re-inversion).

---

## Final verification (run before handing back to the orchestrator)

```
npm run typecheck            # tsc -b clean
npm run lint                 # prettier --check
npm run lint:overhaul        # exit 0; window-dialog count dropped by the 4 retired sites
npm test                     # ~7 known-baseline failures OK; new *.test.ts green
npm run build --workspace @g5000/web   # next build succeeds, every route resolves
```

Do **not** git commit — the orchestrator commits after verify + smoke.

## Notes / deferrals

- The full Field family (`CoordField` verbatim from `lib/coords`, custom `SelectField` popover,
  `Slider`, custom `Checkbox`/`Radio`) is scoped to the Field-heavy Boat/Settings phase; Task 1/2
  build only what the Phase-3 safety wave needs. If a `ConfirmDialog` needs a text field, add a
  minimal `Input` to `Button.tsx`/a new `Field.tsx` rather than pulling the whole family forward.
- `CellGrid`, `DataTable`, `Dial`, chart Tier-2 primitives, `PageHeader`, `Drawer/BottomSheet`,
  `Popover/Menu`, and the on-map Tier-3 chrome are **Phase 4/5** — not this plan.
- Radius-token decision (Task 1) is a one-time call that binds every subsequent primitive; record
  it in the PR description.
