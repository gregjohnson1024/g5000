# Chart Waypoint Select + Edit Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a waypoint dot on the chart (when drop-mode is off) to open an anchored bubble that edits the waypoint's name/position/notes and can delete it (respecting the in-use-by-route 409 guard).

**Architecture:** Thread the waypoint `id` through `MarkLike` into the dot-layer GeoJSON `properties` so a `map.on('click', 'waypoints-dot')` handler can identify the clicked waypoint and call `onSelectWaypoint(id)` (gated to non-drop-mode via the chart passing `undefined` otherwise). A new `WaypointEditPopup` React overlay projects the waypoint's lat/lon to screen pixels via `map.project()` (re-projecting on map move/zoom) and renders an edit form backed by a pure `parseWaypointForm` helper, PUT/DELETE to `/api/waypoints/{id}`.

**Tech Stack:** TypeScript (ESM, strict), Next.js 16, React 19, MapLibre, vitest. Spec: `docs/superpowers/specs/2026-05-23-chart-waypoint-edit-popup-design.md`.

**Current refs:**
- `WaypointsLayer.tsx`: `MarkLike = { lat, lon, name?, badge? }`; `DOT_LAYER = 'waypoints-dot'`; dot features set `properties.id = '${i}'` (index). Mount-once effect on `[map]`; `sync()` builds features from `marksRef.current`.
- `chart/page.tsx`: `waypoints` state `Array<{ id, name, lat, lon }>`; maps to `marks={waypoints.map((w) => ({ lat, lon, name }))}`; has `waypointDropActive`, `mapInstance`, `setError`. `fmtLatLonDmm(lat, lon)` from `../../lib/format-coords`. `parseLatLon(raw)` from `../../lib/coords` (throws on bad input).
- API: `PUT /api/waypoints/{id}` body `{ name, lat, lon, notes? }`; `DELETE /api/waypoints/{id}` → 200 or 409 `{ error: { code:'waypoint_in_use', message, routes } }`.

---

## File structure

**Create:**
- `packages/web/src/components/waypoint-form.ts` — `parseWaypointForm` pure helper.
- `packages/web/src/components/waypoint-form.test.ts`
- `packages/web/src/components/WaypointEditPopup.tsx` — anchored editable card.

**Modify:**
- `packages/web/src/components/WaypointsLayer.tsx` — `id` on `MarkLike` + dot props; `onSelectWaypoint` click handler + pointer cursor.
- `packages/web/src/app/chart/page.tsx` — `selectedWaypointId`; marks carry `id`; gated `onSelectWaypoint`; render popup; update state on save/delete; clear selection on drop-mode.

---

## Task 1: `parseWaypointForm` pure helper

**Files:**
- Create: `packages/web/src/components/waypoint-form.ts`
- Test: `packages/web/src/components/waypoint-form.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/components/waypoint-form.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseWaypointForm } from './waypoint-form';

describe('parseWaypointForm', () => {
  it('parses a valid name + DMM position + notes', () => {
    const r = parseWaypointForm({ name: 'Newport', positionRaw: '41 29.2n 71 19.5w', notes: 'fuel' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.name).toBe('Newport');
      expect(r.patch.lat).toBeCloseTo(41.4867, 3);
      expect(r.patch.lon).toBeCloseTo(-71.325, 3);
      expect(r.patch.notes).toBe('fuel');
    }
  });
  it('omits notes when blank', () => {
    const r = parseWaypointForm({ name: 'X', positionRaw: '41 0n 71 0w', notes: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.notes).toBeUndefined();
  });
  it('rejects an empty name', () => {
    const r = parseWaypointForm({ name: '  ', positionRaw: '41 0n 71 0w', notes: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });
  it('rejects an unparseable position', () => {
    const r = parseWaypointForm({ name: 'X', positionRaw: 'not coords', notes: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/position|coordinate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/components/waypoint-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`packages/web/src/components/waypoint-form.ts`:
```ts
import { parseLatLon } from '../lib/coords';

export interface WaypointFormInput {
  name: string;
  positionRaw: string;
  notes: string;
}

export interface WaypointPatch {
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}

export type ParseResult = { ok: true; patch: WaypointPatch } | { ok: false; error: string };

/** Validate + parse the edit form into a PUT body, or return a user error. */
export function parseWaypointForm(input: WaypointFormInput): ParseResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required' };
  let lat: number;
  let lon: number;
  try {
    ({ lat, lon } = parseLatLon(input.positionRaw));
  } catch {
    return { ok: false, error: 'Position must be a valid coordinate (e.g. 41 29.2n 71 19.5w)' };
  }
  const notes = input.notes.trim();
  return { ok: true, patch: { name, lat, lon, ...(notes ? { notes } : {}) } };
}
```

> Verify `parseLatLon`'s exact signature/throw behavior in `packages/web/src/lib/coords.ts` and adjust the destructure if it differs (it returns `{ lat, lon }` and throws on unparseable input).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/components/waypoint-form.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/waypoint-form.ts packages/web/src/components/waypoint-form.test.ts
git commit -m "feat(web): parseWaypointForm helper for waypoint edit popup"
```

---

## Task 2: WaypointsLayer — selectable dots

**Files:**
- Modify: `packages/web/src/components/WaypointsLayer.tsx`

- [ ] **Step 1: Add `id` to `MarkLike` + dot feature properties**

Add to the interface:
```ts
export interface MarkLike {
  /** Waypoint id, when this mark is a saved waypoint (enables selection). */
  id?: string;
  lat: number;
  lon: number;
  name?: string;
  badge?: 'S' | 'E';
}
```
In `sync()`, change the feature `properties.id` from the index to the mark's id, falling back to the index for id-less marks:
```ts
properties: {
  id: m.id ?? `${i}`,
  name: m.name ?? null,
  ...(m.badge ? { badge: m.badge } : {}),
},
```

- [ ] **Step 2: Add `onSelectWaypoint` prop + a ref for the latest callback**

Change the signature:
```ts
export function WaypointsLayer({
  map,
  marks,
  onSelectWaypoint,
}: {
  map: maplibregl.Map | null;
  marks: MarkLike[];
  /** Called with the waypoint id when a dot is clicked. Pass undefined to
   * disable selection (e.g. while waypoint-drop mode is active). */
  onSelectWaypoint?: (id: string) => void;
}) {
```
Add a ref so the bound listeners always see the latest callback without rebinding:
```ts
const onSelectRef = useRef<((id: string) => void) | undefined>(onSelectWaypoint);
onSelectRef.current = onSelectWaypoint;
```

- [ ] **Step 3: Bind click + cursor handlers in the mount-once effect**

Inside the `useEffect(..., [map])`, after `syncRef.current = sync;` and before the `return`, add:
```ts
const onDotClick = (e: maplibregl.MapLayerMouseEvent): void => {
  const id = e.features?.[0]?.properties?.id;
  if (typeof id === 'string' && onSelectRef.current) onSelectRef.current(id);
};
const onEnter = (): void => {
  if (onSelectRef.current) map.getCanvas().style.cursor = 'pointer';
};
const onLeave = (): void => {
  // Only clear if WE set it (selection enabled). When drop-mode owns the
  // cursor (crosshair) selection is disabled, so onSelectRef is undefined
  // and we never set/!clear pointer here.
  if (onSelectRef.current) map.getCanvas().style.cursor = '';
};
map.on('click', DOT_LAYER, onDotClick);
map.on('mouseenter', DOT_LAYER, onEnter);
map.on('mouseleave', DOT_LAYER, onLeave);
```
And in the cleanup `return () => { ... }`, before the layer removal, add:
```ts
map.off('click', DOT_LAYER, onDotClick);
map.off('mouseenter', DOT_LAYER, onEnter);
map.off('mouseleave', DOT_LAYER, onLeave);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes. (`MapLayerMouseEvent` is exported by maplibre-gl; if the import style differs, use `maplibregl.MapLayerMouseEvent`.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/WaypointsLayer.tsx
git commit -m "feat(web): WaypointsLayer dots are selectable (onSelectWaypoint)"
```

---

## Task 3: `WaypointEditPopup` anchored editable card

**Files:**
- Create: `packages/web/src/components/WaypointEditPopup.tsx`

- [ ] **Step 1: Implement the component**

`packages/web/src/components/WaypointEditPopup.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { fmtLatLonDmm } from '../lib/format-coords';
import { parseWaypointForm } from './waypoint-form';

export interface EditableWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}

export function WaypointEditPopup({
  map,
  waypoint,
  onSaved,
  onDeleted,
  onClose,
}: {
  map: maplibregl.Map | null;
  waypoint: EditableWaypoint;
  onSaved: (updated: EditableWaypoint) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const [name, setName] = useState(waypoint.name);
  const [positionRaw, setPositionRaw] = useState(fmtLatLonDmm(waypoint.lat, waypoint.lon));
  const [notes, setNotes] = useState(waypoint.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  // Reset the form when a different waypoint is selected.
  useEffect(() => {
    setName(waypoint.name);
    setPositionRaw(fmtLatLonDmm(waypoint.lat, waypoint.lon));
    setNotes(waypoint.notes ?? '');
    setError(null);
  }, [waypoint.id, waypoint.name, waypoint.lat, waypoint.lon, waypoint.notes]);

  // Project the waypoint to screen px; track the map.
  useEffect(() => {
    if (!map) return;
    const project = (): void => {
      const p = map.project([waypoint.lon, waypoint.lat]);
      setPt({ x: p.x, y: p.y });
    };
    project();
    map.on('move', project);
    map.on('zoom', project);
    return () => {
      map.off('move', project);
      map.off('zoom', project);
    };
  }, [map, waypoint.lon, waypoint.lat]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pt) return null;

  const save = async (): Promise<void> => {
    const parsed = parseWaypointForm({ name, positionRaw, notes });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/waypoints/${waypoint.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.patch),
      });
      const j = (await res.json()) as { ok: boolean; waypoint?: EditableWaypoint; error?: { message?: string } };
      if (res.ok && j.ok && j.waypoint) {
        onSaved({
          id: j.waypoint.id,
          name: j.waypoint.name,
          lat: j.waypoint.lat,
          lon: j.waypoint.lon,
          notes: j.waypoint.notes,
        });
      } else {
        setError(j.error?.message ?? 'Save failed');
      }
    } catch {
      setError('Save failed');
    } finally {
      setBusy(false);
    }
  };

  const del = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/waypoints/${waypoint.id}`, { method: 'DELETE' });
      const j = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (res.ok && j.ok) {
        onDeleted(waypoint.id);
      } else {
        setError(j.error?.message ?? 'Delete failed');
      }
    } catch {
      setError('Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute z-30 w-64 -translate-x-1/2 -translate-y-full -mt-3 bg-slate-900/95 border border-slate-700 rounded shadow-lg p-3 space-y-2"
      style={{ left: pt.x, top: pt.y }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-100">Edit waypoint</span>
        <button type="button" onClick={onClose} aria-label="close" className="text-xs text-slate-400 hover:text-slate-200">
          ✕
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded"
      />
      <input
        type="text"
        value={positionRaw}
        onChange={(e) => setPositionRaw(e.target.value)}
        placeholder="41 29.2n 71 19.5w"
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded font-mono"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="notes"
        rows={2}
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded"
      />
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-2 py-1 text-xs rounded border bg-sky-600 text-white border-sky-700 hover:bg-sky-500 disabled:opacity-40">
          Save
        </button>
        <button type="button" onClick={() => void del()} disabled={busy} className="px-2 py-1 text-xs rounded border bg-slate-800 text-rose-300 border-rose-800 hover:bg-rose-950 disabled:opacity-40">
          Delete
        </button>
      </div>
    </div>
  );
}
```
> The popup is positioned at the waypoint's screen px with `-translate-x-1/2 -translate-y-full -mt-3` so it sits centered just above the dot. Verify `fmtLatLonDmm(lat, lon)` exists with that signature in `lib/format-coords` (the chart imports it); if it's named differently, use the chart's existing import.

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck --workspace @g5000/web` → passes.
```bash
git add packages/web/src/components/WaypointEditPopup.tsx
git commit -m "feat(web): WaypointEditPopup anchored edit card"
```

---

## Task 4: Wire selection + popup into the chart

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: State + imports**

- Import: `import { WaypointEditPopup } from '../../components/WaypointEditPopup';`
- Add state: `const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);`

- [ ] **Step 2: Marks carry the id; selection gated on drop-mode**

Find the `<WaypointsLayer ... />` mount. Change its `marks` to include the id and add the gated `onSelectWaypoint`:
```tsx
<WaypointsLayer
  map={mapInstance}
  marks={waypoints.map((w) => ({ id: w.id, lat: w.lat, lon: w.lon, name: w.name }))}
  onSelectWaypoint={waypointDropActive ? undefined : (id) => setSelectedWaypointId(id)}
/>
```

- [ ] **Step 3: Clear selection when entering drop-mode**

Where `waypointDropActive` is toggled on (the `onToggleWaypointDrop` handler passed to `ChartToolbar`), also clear the selection so the two don't overlap. Simplest — add an effect:
```tsx
useEffect(() => {
  if (waypointDropActive) setSelectedWaypointId(null);
}, [waypointDropActive]);
```

- [ ] **Step 4: Render the popup**

After the `<WaypointsLayer>` / near the other map-overlay React nodes, add:
```tsx
{(() => {
  const sel = selectedWaypointId ? waypoints.find((w) => w.id === selectedWaypointId) : null;
  if (!sel) return null;
  return (
    <WaypointEditPopup
      map={mapInstance}
      waypoint={{ id: sel.id, name: sel.name, lat: sel.lat, lon: sel.lon }}
      onSaved={(updated) => {
        setWaypoints((prev) => prev.map((w) => (w.id === updated.id ? { id: updated.id, name: updated.name, lat: updated.lat, lon: updated.lon } : w)));
      }}
      onDeleted={(id) => {
        setWaypoints((prev) => prev.filter((w) => w.id !== id));
        setSelectedWaypointId(null);
      }}
      onClose={() => setSelectedWaypointId(null)}
    />
  );
})()}
```
> The chart's `waypoints` state element is `{ id, name, lat, lon }` (no `notes`). The popup's `EditableWaypoint` accepts an optional `notes`; passing it absent is fine. If you want notes to round-trip in the chart state, widen the `waypoints` state to include `notes?` — optional, not required for this task. Keep the popup mounted inside the relative map-column div so its `absolute` positioning is relative to the map, matching where `ChartToolbar` sits.

- [ ] **Step 5: Typecheck + smoke + commit**

Run: `npm run typecheck --workspace @g5000/web` → passes.
`curl -s -o /dev/null -w "/chart %{http_code}\n" http://localhost:3000/chart` → 200.
```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): chart waypoint selection + edit popup wiring"
```

---

## Task 5: Verification

- [ ] **Step 1: Tests + typecheck**

`npx vitest run packages/web/src/components/waypoint-form.test.ts` → 4 pass.
`npm run typecheck --workspace @g5000/web` → clean. `npm run typecheck` (orchestrated) → clean.

- [ ] **Step 2: Browser functional test (Playwright, 1440×900)**

Load `/chart`. With drop-mode OFF: click a waypoint dot → the edit bubble opens anchored at the waypoint; change the name → Save → label updates and bubble reflects it; edit the position DMM to a nearby coord → Save → the dot moves. Click a waypoint NOT used by a route → Delete → it disappears. Create a route on `/routes` referencing a waypoint, then try to Delete that waypoint here → the 409 message names the route and the waypoint stays. Toggle drop-mode ON → clicking a dot no longer opens the popup (it would drop a new waypoint instead). Pan the map with the bubble open → it stays anchored to the waypoint. Clean up any test waypoints/routes via the API.

- [ ] **Step 3: Format**

`npm run format`; commit only if it changed files: `git add -A && git commit -m "chore: format"`.

---

## Self-review notes

- **Spec coverage:** id threaded into MarkLike + dot props + click handler (T2); anchored React overlay projected + tracked (T3); full edit name/position/notes via `parseWaypointForm` (T1, T3); Save PUT + Delete with 409 message (T3); selection gated to non-drop-mode + cleared on drop-mode (T4); state updates on save/delete (T4). All spec sections mapped.
- **Type consistency:** `parseWaypointForm`/`WaypointPatch` (T1) used by `WaypointEditPopup` (T3); `EditableWaypoint` shape consistent T3↔T4; `onSelectWaypoint: (id: string) => void` consistent T2↔T4; chart `waypoints` element `{id,name,lat,lon}` used consistently.
- **Soft spots flagged:** `parseLatLon` signature (T1) and `fmtLatLonDmm` signature (T3) to verify against the real lib; the chart `waypoints` state omits `notes` so the popup can edit notes but the chart won't re-display them until the state is widened (noted in T4, optional).
```
