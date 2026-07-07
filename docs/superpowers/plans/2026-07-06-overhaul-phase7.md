# Phase 7 — Cleanup & enforcement (UI overhaul)

Branch: `ui-overhaul`. FINAL phase before deploy. Ships to a live boat (`Sula`) —
be conservative. Tokens only. Do NOT `git commit` / `git stash` (the orchestrator
commits after the final gate). Map.tsx stays untouched.

Phase 6 shipped without its review (session limit). This phase therefore opens with
the consolidated P6 review (commit `c618272`) already adjudicated below, then does the
cleanup work.

## References read

- Proposal §9 (migration — Phase 7): "compat bridge deleted; dead legacy page code
  removed; lint tightened to full token enforcement; QA sweep; keep-list re-verified."
- `docs/design/overhaul-keep-list.md` — the full keep-list (law).
- P6 review verdict: **approve**; CaptureWizard rec: **WIRE** (genuine de-dup of the
  bsp/compass cal flows), do not delete.

## Adjudication of the P6 review

- **Important — CaptureWizard shipped unwired.** Accept → Task 2 (wire it into the cal
  pages).
- **Important — AIS consolidation partial (`/ais` still a full legacy page; AisLens
  hand-rolls its sort).** Accept the dead-page half → Task 3 deletes the 4 unreachable
  `app/ais/*.tsx` files. The AisLens sort de-dup is behavior-sensitive (safety invariant:
  threats-float + stale-exclusion) and OPTIONAL per scout; **defer** it — a behavior-preserving
  refactor with no visual payoff is not worth the risk on a safety surface this close to deploy.
- **Minor — RampLegend equal-width swatches misrepresent diverging stop positions.** Latent
  only (both live consumers are sequential). Fix = document the constraint; do not re-architect.
  → Task 1.
- **Minor — smuggled banned font sizes** (`RampLegend` inline `fontSize:'11px'`,
  `CaptureWizard` `text-[1rem]` heading) route a banned type size around the linter. → Task 1.
- **Minor — PATCH shallow-merge last-write-wins per top-level key.** This is the documented
  per-client-key-ownership design; no action, invariant noted.

## Verified facts (grepped on `ui-overhaul`)

- `app/ais/{page,client-view,RadarScope,TargetsTable}.tsx` have **zero external importers**.
  The one `voyage/logbook` hit is its own local `./client-view` (TripsClientView), unrelated.
- `app/ais/use-ais-targets.ts` + `app/ais/use-threat-audio.ts` are **LIVE** — imported by
  `app/chart/lenses/AisLens.tsx`. Must be KEPT.
- `CaptureWizard.tsx` + `capture-wizard.ts` are a confirmed orphan pair (only import each other).
- `npm run lint:overhaul` currently reports **248 violations / 549 files** (hex 190, tiny-text 49,
  dialog 1, EventSource 8, internal-`<a>` 0), always exits 0.
- Compat bridge lives in `packages/web/src/app/globals.css` (~L558-640 `@theme` remap of ~60
  `--color-*` vars + `--compat-*` fidelity vars ~L122-149). **920 raw palette-utility usages
  across 63 files still resolve THROUGH it** (slate 615, amber 101, zinc 57, red 48, …). The
  linter does NOT track these — they are a separate, much larger tokenization effort.

## Hard constraints

- Map.tsx untouched. Do NOT remove the compat bridge (would break DAY visuals + NIGHT/SUN
  theming of 920 un-migrated utility usages). Do NOT delete anything still imported (grep first).
  App builds + every route resolves + tests stay at baseline (~4 failed / 690+ passed).
- Do NOT make lint:overhaul globally exit-1 (the tree has 248 live violations → would fail CI).

## Gate (run after every task, must be green/baseline before the phase is done)

`npm run typecheck` · `npm run test` (baseline ~4 fail OK) · `npm run lint` (prettier) ·
`npm run build --workspace @g5000/web` · `npm run lint:overhaul` (report count) · manual: every
route still resolves (esp. `/ais` → redirect, `/boat/setup/cal/bsp`, `/boat/setup/cal/compass`,
`/chart` AIS lens).

---

## Tasks (ordered)

### P7-1 — P6 review Minor fixes (tokenize smuggled sizes + document diverging legend)

Files: `packages/web/src/components/charts/RampLegend.tsx`,
`packages/web/src/components/ui/CaptureWizard.tsx`.

- Replace `RampLegend` inline `style={{ fontSize: '11px' }}` with the caption type token /
  `text-caption` class (whatever the tokenized label size is app-wide).
- Replace `CaptureWizard` `text-[1rem]` heading with the matching type-scale token.
- Add a short code comment on `RampLegend`'s equal-width (`flex-1`) swatch row noting it is
  correct for **sequential** ramps only and would misrepresent diverging stop positions; both
  live consumers are sequential, so this is a documented latent constraint, not a live bug.
  Acceptance: `lint:overhaul` tiny-text count drops by the RampLegend occurrence; no `text-[…px]`
  or inline pixel font-size remains in either file; RampLegend/CaptureWizard render identically
  (sequential legend + wizard heading unchanged); typecheck + build green.

### P7-2 — Wire CaptureWizard into the calibration pages (resolves Important + WIRE decision)

Files: `packages/web/src/components/ui/CaptureWizard.tsx` (consume as-is),
`packages/web/src/components/ui/capture-wizard.ts`,
`packages/web/src/app/boat/setup/cal/bsp/page.tsx` (hand-rolled flow ~L25-68, ~L225-241),
then `packages/web/src/app/boat/setup/cal/compass/page.tsx` (~L34-77, ~L233-250).

- Replace each page's inline `idle→capturing→reviewing→applied` state machine with
  `<CaptureWizard>`, passing each page's `compute()` / averaging producer and `onApply`.
- **Preserve UX verbatim:** the 5 s averaging window, the exact "Capture failed…" / "Capture
  wizard" strings, Apply/Discard semantics, and the reviewing preview. This is a
  behavior-preserving de-dup (~60 lines/page collapse into the shared primitive), NOT a redesign.
- Do bsp first, verify, then compass (same pattern).
  Acceptance: `CaptureWizard` + `capture-wizard.ts` now have ≥1 importer (no longer orphan);
  bsp + compass cal pages capture, average over 5 s, and Apply/Discard with unchanged copy and
  error handling; typecheck + build green; a manual capture on both pages behaves as before.

### P7-3 — Dead-code sweep + compat-bridge conservatism

Files to DELETE (0 external importers, `/ais` is a permanent redirect → `/chart?lens=ais`):
`packages/web/src/app/ais/page.tsx`, `packages/web/src/app/ais/client-view.tsx`,
`packages/web/src/app/ais/RadarScope.tsx`, `packages/web/src/app/ais/TargetsTable.tsx`.
Files to KEEP (LIVE, imported by AisLens): `app/ais/use-ais-targets.ts`,
`app/ais/use-threat-audio.ts`.

- Re-grep each deletion target for importers immediately before removing; abort a deletion if
  any importer appears. After deletion, confirm `/ais` still resolves via the redirect and the
  chart AIS lens still works.
- Remove any now-dead imports flagged across phases that grep proves unreferenced.
- **Compat bridge: KEEP.** Do a per-shade audit only: for each individual `--color-<family>-<shade>`
  line in the bridge, grep the app for a matching utility (`<family>-<shade>`); a shade with
  **zero** matches app-wide MAY be dropped. Do NOT bulk-remove families; do NOT remove the block.
  If in doubt, keep. Record in this plan which shades (if any) were trimmed and the grep that
  justified each.
- Out of scope (do NOT touch): `GulfStreamLayer`, `RangeRings`, `TileGridOverlay`, `RouteTimeline`
  — pre-existing dead layers from before the branch, not overhaul-caused; GulfStreamLayer has a
  documented one-line-revert mount intent.
  Acceptance: 4 AIS files gone; 2 AIS hooks retained; `rg -l ais/client-view|ais/RadarScope|ais/TargetsTable`
  returns nothing; `/ais` redirect + chart AIS lens verified; compat bridge block still present;
  any trimmed shade documented with its zero-match grep; build green + every route resolves.

### P7-4 — Tighten lint:overhaul (new-code only, non-breaking)

Files: `scripts/lint-overhaul.mjs`, `package.json` (script wiring if needed).

- Add opt-in strict mode that exits **1** only for NEW raw-hex / banned sizes in NEW files —
  scope via git-diff against the merge-base (added/renamed files only) OR a small allowlist of
  already-clean dirs (e.g. `components/ui`, `components/charts` after P7-1). Keep the existing
  full-tree scan reporting the 248 legacy violations as **non-blocking (exit 0)**.
- Default `npm run lint:overhaul` must stay exit-0 over the current tree (still 248, minus any
  fixed in P7-1). Strict enforcement is the scoped/new-code path only.
- Report the final count in this plan and in the task output.
  Acceptance: running `lint:overhaul` on the current tree still exits 0 and prints the count;
  the strict path exits 1 when fed a NEW file containing a raw hex or `text-[10px]` and exits 0
  otherwise; `components/ui` + `components/charts` are clean of hex/tiny-text after P7-1 so gating
  them does not fail; CI/build unaffected.

### P7-5 — Keep-list re-verify + fix any regression, then final gate

File: audit against `docs/design/overhaul-keep-list.md`; fix any regression in the offending
component (tokens only). Report each item Verified / Regressed.

- Map.tsx gesture engine + `__above-wind__` sentinel: `git diff` vs develop merge-base for
  `Map.tsx` is empty → report **Verified**, no action.
- AIS threats-float + stale-exclusion: confirm `AisLens` still floats threats / excludes stale
  after P7-3; `data-table-sort.test.ts` green.
- StalenessShroud on every live value: spot-check `/sail` (helm) + `/sail/autopilot`.
- Compact DMM lat/lon + UTC-everywhere: spot-check `/voyage/plan` (DataTable) and chart
  AnchorCard/InspectPanel — coords as `33 42.232n 66 25.240w`, no UTC+local mix on one panel.
- Zero-reflow AlarmLane pre-reserved slot in `NavShell.tsx` (alarm fires with no layout shift).
- WindDial port/stbd correctness + NIGHT hue-ban (shape/glyph, not hue).
- Offline-honest empty states (`—` in reserved slot) after glance-surface rebuild.
  Acceptance: keep-list table Verified/Regressed reported; any regression fixed with tokens only;
  final gate green — typecheck, tests at baseline, prettier clean, `@g5000/web` build succeeds,
  `lint:overhaul` count reported, every route resolves. Ready for orchestrator commit.
