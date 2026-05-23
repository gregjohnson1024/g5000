# Track annotations + period markers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drop labelled annotations + period start/end markers in real time from `/chart` and `/helm`, persisted in the active track's JSON file. `/tracks` lists them and lets the user view + JSON-download the cropped slice between any paired periodStart/periodEnd.

**Architecture:** Annotations live as a new optional array on the existing `Track` interface (file-based storage at `~/.g5000-router/tracks/<id>.json`). One server route handles GET + POST on the active track's annotations; a second route returns a sliced subset of a track for offline analysis. A small floating `<AnnotationDropper>` component is mounted on both `/chart` and `/helm`. The `/tracks` page gains an annotations disclosure and a slice viewer.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript strict (`noUncheckedIndexedAccess`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-22-track-annotations-design.md`

---

## File Structure

| File                                                              | Purpose                                                                                                                                                              | Status |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `packages/web/src/lib/tracks.ts`                                  | Add `TrackAnnotation` interface, extend `Track` with optional `annotations`, add `appendAnnotation(id, ann)` helper, add pure `openPeriodStart(annotations)` helper. | modify |
| `packages/web/src/lib/tracks.test.ts`                             | Vitest for `openPeriodStart` covering empty / events-only / single-open / closed / nested-then-open.                                                                 | new    |
| `packages/web/src/app/api/tracks/active/annotation/route.ts`      | GET (lightweight: annotations + trackId) and POST (validate body, stamp tsMs, append, return updated list).                                                          | new    |
| `packages/web/src/app/api/tracks/active/annotation/route.test.ts` | Vitest for GET (with/without active) and POST (happy path, validation, no-active-track).                                                                             | new    |
| `packages/web/src/app/api/tracks/[id]/slice/route.ts`             | GET ?from=&to= → `{ points, annotations }` filtered to inclusive range.                                                                                              | new    |
| `packages/web/src/app/api/tracks/[id]/slice/route.test.ts`        | Vitest for inclusive bounds, missing-params 400, missing-track 404.                                                                                                  | new    |
| `packages/web/src/components/AnnotationDropper.tsx`               | Floating widget: collapsed pill + expandable panel of quick buttons + custom-text input. Polls GET endpoint every 30 s.                                              | new    |
| `packages/web/src/app/chart/page.tsx`                             | Mount `<AnnotationDropper>` top-right (right-14 to clear NOAA button).                                                                                               | modify |
| `packages/web/src/app/helm/page.tsx`                              | Mount `<AnnotationDropper>` top-right.                                                                                                                               | modify |
| `packages/web/src/app/tracks/page.tsx`                            | Annotations disclosure + slice viewer (inline panel + Download JSON).                                                                                                | modify |

No bus channels, no DB schema, no new dependencies.

---

## Task 1: `openPeriodStart` pure helper + tests

**Files:**

- Modify: `packages/web/src/lib/tracks.ts`
- Create: `packages/web/src/lib/tracks.test.ts`

Pure helper for computing "the most recent unpaired periodStart". The widget and the `/tracks` UI both use it.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/lib/tracks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openPeriodStart, type TrackAnnotation } from './tracks';

function a(tsMs: number, label: string, kind: TrackAnnotation['kind']): TrackAnnotation {
  return { tsMs, label, kind };
}

describe('openPeriodStart', () => {
  it('returns null for an empty array', () => {
    expect(openPeriodStart([])).toBeNull();
  });

  it('returns null when there are only event annotations', () => {
    expect(openPeriodStart([a(1, 'Tack', 'event'), a(2, 'J3', 'event')])).toBeNull();
  });

  it('returns the periodStart when no periodEnd follows', () => {
    const start = a(10, 'Start period', 'periodStart');
    expect(openPeriodStart([a(5, 'Tack', 'event'), start])).toEqual(start);
  });

  it('returns null when periodStart is followed by periodEnd', () => {
    expect(
      openPeriodStart([a(10, 'Start period', 'periodStart'), a(20, 'End period', 'periodEnd')]),
    ).toBeNull();
  });

  it('returns the most recent open period when there are two', () => {
    const second = a(40, 'Start period', 'periodStart');
    expect(
      openPeriodStart([
        a(10, 'Start period', 'periodStart'),
        a(20, 'End period', 'periodEnd'),
        a(30, 'Tack', 'event'),
        second,
      ]),
    ).toEqual(second);
  });

  it('uses array order — does not re-sort by tsMs', () => {
    // Defensive: callers pass annotations in insertion order; we trust them.
    const start = a(100, 'Start period', 'periodStart');
    expect(openPeriodStart([a(50, 'End period', 'periodEnd'), start])).toEqual(start);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run packages/web/src/lib/tracks.test.ts
```

Expected: fail with a missing-export error (`openPeriodStart` doesn't exist yet).

- [ ] **Step 3: Add the type and helper to `tracks.ts`**

Insert the following BEFORE the existing `export interface TrackPoint` block in `packages/web/src/lib/tracks.ts`:

```ts
export interface TrackAnnotation {
  /** Unix ms when the marker was dropped. Server-assigned at append time. */
  tsMs: number;
  /** Display label — pre-set ("J3", "Tack") or custom free text. */
  label: string;
  /** Discriminator. `event` = single moment; `periodStart` / `periodEnd`
   * come in pairs and define a croppable range. */
  kind: 'event' | 'periodStart' | 'periodEnd';
}

/**
 * Return the most recent `periodStart` in `annotations` that is NOT
 * followed by a `periodEnd`. Returns null when no period is open.
 *
 * Pure; callers pass annotations in insertion order (we don't re-sort).
 */
export function openPeriodStart(annotations: TrackAnnotation[]): TrackAnnotation | null {
  let open: TrackAnnotation | null = null;
  for (const a of annotations) {
    if (a.kind === 'periodStart') open = a;
    else if (a.kind === 'periodEnd') open = null;
  }
  return open;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run packages/web/src/lib/tracks.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean. If stale-dist errors mention `@g5000/db` or `@g5000/core`:

```bash
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/routing packages/coastline
```

then re-typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/tracks.ts packages/web/src/lib/tracks.test.ts
git commit -m "feat(web): track annotations — TrackAnnotation type + openPeriodStart

Adds the TrackAnnotation interface to lib/tracks.ts plus a pure
openPeriodStart helper that returns the most recent unpaired
periodStart. Used by the floating dropper widget to highlight the
'End period' button and by /tracks to detect open periods.

No Track shape change yet — the optional annotations field on the
Track interface lands with the appendAnnotation helper in the next
task."
```

---

## Task 2: Extend `Track` + `appendAnnotation` helper

**Files:**

- Modify: `packages/web/src/lib/tracks.ts`

Add the optional `annotations` field to `Track` and an `appendAnnotation` helper that mirrors `appendPoint`'s shape: read, mutate, write atomically.

- [ ] **Step 1: Extend the `Track` interface**

In `packages/web/src/lib/tracks.ts`, find the existing block:

```ts
export interface Track extends TrackMeta {
  points: TrackPoint[];
}
```

Replace with:

```ts
export interface Track extends TrackMeta {
  points: TrackPoint[];
  /** Hand-dropped markers in chronological order. Absent on older files;
   * `getTrack` always normalises to []. */
  annotations?: TrackAnnotation[];
}
```

- [ ] **Step 2: Add `appendAnnotation`**

After the existing `appendPoint` function in `packages/web/src/lib/tracks.ts`, add:

```ts
/**
 * Append a TrackAnnotation to the active track at `id`. The annotation's
 * `tsMs` should be set by the caller (the API route uses `Date.now()`).
 * Returns the updated track, or null if the id doesn't exist. Throws if
 * the track is already ended.
 */
export async function appendAnnotation(id: string, ann: TrackAnnotation): Promise<Track | null> {
  const t = await getTrack(id);
  if (!t) return null;
  if (t.endedAt !== null) {
    throw new Error(`track ${id} is ended; cannot append annotation`);
  }
  const next: Track = {
    ...t,
    annotations: [...(t.annotations ?? []), ann],
  };
  await writeTrack(next);
  return next;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 4: Existing tests still pass**

```bash
npx vitest run packages/web/src/lib/tracks.test.ts
```

Expected: still 6 passing (no new tests in this task; we test `appendAnnotation` via the route test in Task 3).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/tracks.ts
git commit -m "feat(web): track annotations — appendAnnotation helper + Track shape

Track interface gains an optional annotations array. appendAnnotation
mirrors appendPoint: read, mutate, atomic write. Refuses to append
to an ended track. Older track files without an annotations field
read as if it were empty."
```

---

## Task 3: `POST` / `GET` `/api/tracks/active/annotation`

**Files:**

- Create: `packages/web/src/app/api/tracks/active/annotation/route.ts`
- Create: `packages/web/src/app/api/tracks/active/annotation/route.test.ts`

The dropper's read+write endpoint.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/tracks/active/annotation/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: () => Promise<Response>;
let POST: (req: Request) => Promise<Response>;
let createTrack: (label?: string) => Promise<{ id: string }>;
let interruptActive: (label?: string) => Promise<{ id: string }>;

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-track-ann-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  const route = (await import('./route')) as {
    GET: () => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  };
  GET = route.GET;
  POST = route.POST;
  const tracks = await import('../../../../../lib/tracks');
  createTrack = tracks.createTrack;
  interruptActive = tracks.interruptActive;
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('GET /api/tracks/active/annotation', () => {
  it('returns trackId=null and empty annotations when no active track exists', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackId: string | null; annotations: unknown[] };
    expect(body.trackId).toBeNull();
    expect(body.annotations).toEqual([]);
  });

  it('returns the active track id and its annotations', async () => {
    const t = await createTrack('test');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackId: string; annotations: unknown[] };
    expect(body.trackId).toBe(t.id);
    expect(body.annotations).toEqual([]);
  });
});

describe('POST /api/tracks/active/annotation', () => {
  it('appends an event annotation and returns the updated list', async () => {
    const t = await createTrack('test');
    const before = Date.now();
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trackId: string;
      annotations: Array<{ tsMs: number; label: string; kind: string }>;
    };
    expect(body.trackId).toBe(t.id);
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0]?.label).toBe('Tack');
    expect(body.annotations[0]?.kind).toBe('event');
    expect(body.annotations[0]?.tsMs).toBeGreaterThanOrEqual(before);
    expect(body.annotations[0]?.tsMs).toBeLessThanOrEqual(after);
  });

  it('returns 404 when no active track exists', async () => {
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing label', async () => {
    await createTrack('test');
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'event' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid kind', async () => {
    await createTrack('test');
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'whatever' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('preserves earlier annotations when appending', async () => {
    await createTrack('test');
    await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Tack', kind: 'event' }),
      }),
    );
    const res = await POST(
      new Request('http://x/api/tracks/active/annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Start period', kind: 'periodStart' }),
      }),
    );
    const body = (await res.json()) as {
      annotations: Array<{ label: string; kind: string }>;
    };
    expect(body.annotations.map((a) => a.label)).toEqual(['Tack', 'Start period']);
    expect(body.annotations.map((a) => a.kind)).toEqual(['event', 'periodStart']);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run packages/web/src/app/api/tracks/active/annotation/route.test.ts
```

Expected: fail with module-not-found.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/tracks/active/annotation/route.ts`:

```ts
import { activeTrack, appendAnnotation, type TrackAnnotation } from '../../../../../lib/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS = new Set<TrackAnnotation['kind']>(['event', 'periodStart', 'periodEnd']);

/**
 * GET /api/tracks/active/annotation
 *
 * Lightweight read — returns just the annotations and the track id
 * (no points). Used by <AnnotationDropper> to discover open-period
 * state without dragging the full points payload.
 */
export async function GET(): Promise<Response> {
  const t = await activeTrack();
  if (!t) return Response.json({ trackId: null, annotations: [] });
  return Response.json({ trackId: t.id, annotations: t.annotations ?? [] });
}

/**
 * POST /api/tracks/active/annotation
 *
 * Body: { label: string, kind: 'event' | 'periodStart' | 'periodEnd' }
 *
 * Server stamps tsMs = Date.now() and appends. 404 when there is no
 * active track. 400 on validation failure.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'expected an object' }, { status: 400 });
  }
  const { label, kind } = body as { label?: unknown; kind?: unknown };
  if (typeof label !== 'string' || label.length === 0) {
    return Response.json({ error: 'label is required' }, { status: 400 });
  }
  if (typeof kind !== 'string' || !KINDS.has(kind as TrackAnnotation['kind'])) {
    return Response.json(
      { error: `kind must be one of: ${[...KINDS].join(', ')}` },
      { status: 400 },
    );
  }
  const t = await activeTrack();
  if (!t) return Response.json({ error: 'no active track' }, { status: 404 });
  const ann: TrackAnnotation = {
    tsMs: Date.now(),
    label,
    kind: kind as TrackAnnotation['kind'],
  };
  const updated = await appendAnnotation(t.id, ann);
  if (!updated) {
    return Response.json({ error: 'active track disappeared' }, { status: 404 });
  }
  return Response.json({
    trackId: updated.id,
    annotations: updated.annotations ?? [],
  });
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run packages/web/src/app/api/tracks/active/annotation/route.test.ts
```

Expected: 7 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/tracks/active/annotation/route.ts packages/web/src/app/api/tracks/active/annotation/route.test.ts
git commit -m "feat(web): /api/tracks/active/annotation GET + POST

GET returns the active track's id and annotations (lightweight; no
points). POST validates the body, stamps tsMs server-side, appends
to the active track via appendAnnotation, returns the updated list.
Returns 404 when no active track exists, 400 on validation failure."
```

---

## Task 4: `GET /api/tracks/[id]/slice`

**Files:**

- Create: `packages/web/src/app/api/tracks/[id]/slice/route.ts`
- Create: `packages/web/src/app/api/tracks/[id]/slice/route.test.ts`

Returns points + annotations filtered to an inclusive `[from, to]` timestamp range.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/tracks/[id]/slice/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

let createTrack: (label?: string) => Promise<{ id: string }>;
let appendPoint: (id: string, pt: { t: number; lat: number; lon: number }) => Promise<unknown>;
let appendAnnotation: (
  id: string,
  ann: { tsMs: number; label: string; kind: 'event' | 'periodStart' | 'periodEnd' },
) => Promise<unknown>;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-slice-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  const route = (await import('./route')) as {
    GET: typeof GET;
  };
  GET = route.GET;
  const tracks = await import('../../../../../../lib/tracks');
  createTrack = tracks.createTrack;
  appendPoint = tracks.appendPoint;
  appendAnnotation = tracks.appendAnnotation;
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('GET /api/tracks/[id]/slice', () => {
  it('returns inclusive points within [from, to] (seconds vs ms note: points are seconds, range is ms)', async () => {
    const t = await createTrack('test');
    await appendPoint(t.id, { t: 100, lat: 1, lon: 1 });
    await appendPoint(t.id, { t: 200, lat: 2, lon: 2 });
    await appendPoint(t.id, { t: 300, lat: 3, lon: 3 });
    // TrackPoint.t is seconds; the slice route accepts ms so the user can
    // pass the same ms timestamps annotations carry.
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=200000&to=300000`),
      ctx(t.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: Array<{ t: number }>;
      annotations: unknown[];
    };
    expect(body.points.map((p) => p.t)).toEqual([200, 300]);
    expect(body.annotations).toEqual([]);
  });

  it('returns inclusive annotations within [from, to]', async () => {
    const t = await createTrack('test');
    await appendAnnotation(t.id, { tsMs: 100_000, label: 'a', kind: 'event' });
    await appendAnnotation(t.id, { tsMs: 200_000, label: 'b', kind: 'event' });
    await appendAnnotation(t.id, { tsMs: 300_000, label: 'c', kind: 'event' });
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=200000&to=300000`),
      ctx(t.id),
    );
    const body = (await res.json()) as {
      annotations: Array<{ label: string }>;
    };
    expect(body.annotations.map((a) => a.label)).toEqual(['b', 'c']);
  });

  it('returns empty arrays when from > to', async () => {
    const t = await createTrack('test');
    await appendPoint(t.id, { t: 100, lat: 1, lon: 1 });
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=500000&to=100000`),
      ctx(t.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: unknown[];
      annotations: unknown[];
    };
    expect(body.points).toEqual([]);
    expect(body.annotations).toEqual([]);
  });

  it('returns 400 when from is missing', async () => {
    const t = await createTrack('test');
    const res = await GET(new Request(`http://x/api/tracks/${t.id}/slice?to=100000`), ctx(t.id));
    expect(res.status).toBe(400);
  });

  it('returns 400 when from is non-numeric', async () => {
    const t = await createTrack('test');
    const res = await GET(
      new Request(`http://x/api/tracks/${t.id}/slice?from=notanumber&to=100000`),
      ctx(t.id),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the track does not exist', async () => {
    const res = await GET(
      new Request(`http://x/api/tracks/track-999/slice?from=0&to=100000`),
      ctx('track-999'),
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run packages/web/src/app/api/tracks/\[id\]/slice/route.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/tracks/[id]/slice/route.ts`:

```ts
import { getTrack } from '../../../../../../lib/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/tracks/[id]/slice?from=<tsMs>&to=<tsMs>
 *
 * Returns { points, annotations } filtered to the inclusive timestamp
 * range. `from` and `to` are both required Unix ms. Note that
 * TrackPoint.t is in SECONDS but our range is in MS — we compare in ms
 * for parity with the timestamps annotations carry.
 *
 * - 400 when from / to are missing or non-numeric.
 * - 404 when the track id doesn't exist.
 * - 200 with empty arrays when from > to (no client-visible error).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const from = fromStr === null ? NaN : Number(fromStr);
  const to = toStr === null ? NaN : Number(toStr);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return Response.json(
      { error: 'from and to are required and must be Unix ms' },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  const t = await getTrack(id);
  if (!t) return Response.json({ error: 'track not found' }, { status: 404 });

  if (from > to) {
    return Response.json({ points: [], annotations: [] });
  }
  // TrackPoint.t is seconds; convert to ms for comparison.
  const points = t.points.filter((p) => {
    const tsMs = p.t * 1000;
    return tsMs >= from && tsMs <= to;
  });
  const annotations = (t.annotations ?? []).filter((a) => a.tsMs >= from && a.tsMs <= to);
  return Response.json({ points, annotations });
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run packages/web/src/app/api/tracks/\[id\]/slice/route.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/tracks/\[id\]/slice
git commit -m "feat(web): /api/tracks/[id]/slice GET

Returns { points, annotations } filtered to the inclusive ms range
[from, to]. Note the TrackPoint.t-is-seconds / annotation-tsMs-is-ms
mismatch — the route compares everything in ms by multiplying point
timestamps. 400 on missing/non-numeric params; 404 on missing track;
empty arrays when from > to."
```

---

## Task 5: `<AnnotationDropper>` component

**Files:**

- Create: `packages/web/src/components/AnnotationDropper.tsx`

The floating widget. Polls GET every 30 s. On POST success, updates local state from the response.

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/AnnotationDropper.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openPeriodStart, type TrackAnnotation } from '../lib/tracks';

const POLL_MS = 30_000;

interface DropperState {
  trackId: string | null;
  annotations: TrackAnnotation[];
}

const QUICK_BUTTONS: Array<{ label: string; row: number }> = [
  { label: 'Tack', row: 0 },
  { label: 'Gybe', row: 0 },
  { label: 'Reef in', row: 0 },
  { label: 'Reef out', row: 0 },
  { label: 'Main up', row: 1 },
  { label: 'Main down', row: 1 },
  { label: 'J1', row: 1 },
  { label: 'J2', row: 1 },
  { label: 'J3', row: 1 },
  { label: 'Spinnaker up', row: 2 },
  { label: 'Spinnaker down', row: 2 },
];

/**
 * Floating widget for dropping labelled annotations on the active track.
 *
 * Mounted on /chart and /helm. Polls GET /api/tracks/active/annotation
 * every 30 s; the response also updates after every successful POST.
 *
 * When an open period exists, the collapsed pill turns amber and shows
 * the elapsed minutes; the expanded panel promotes a prominent "End
 * period (N min)" button to the top.
 */
export function AnnotationDropper({
  position = 'top-2 right-2',
}: {
  /** Tailwind position classes — caller decides anchor. /chart uses
   * 'top-2 right-14' to clear the NOAA layers button. */
  position?: string;
}) {
  const [state, setState] = useState<DropperState>({ trackId: null, annotations: [] });
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customKind, setCustomKind] = useState<TrackAnnotation['kind']>('event');
  const [submitting, setSubmitting] = useState(false);
  const [tickMs, setTickMs] = useState<number>(() => Date.now());

  // 1 Hz tick so the "open period — N min" pill updates without polling
  // the server. Cheap; only renders when state changes.
  useEffect(() => {
    const id = window.setInterval(() => setTickMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Initial fetch + 30 s poll.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/tracks/active/annotation', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as DropperState;
        if (alive) setState(body);
      } catch {
        /* offline — keep last good state */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const post = useCallback(
    async (label: string, kind: TrackAnnotation['kind']): Promise<void> => {
      if (!state.trackId || submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch('/api/tracks/active/annotation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label, kind }),
        });
        if (!res.ok) {
          setFlash(`✗ Failed: ${res.status}`);
          window.setTimeout(() => setFlash(null), 1500);
          return;
        }
        const body = (await res.json()) as DropperState;
        setState(body);
        const time = new Date().toISOString().slice(11, 19) + 'Z';
        setFlash(`✓ Marked: ${label} at ${time}`);
        window.setTimeout(() => setFlash(null), 1000);
        setOpen(false);
        setCustomLabel('');
      } finally {
        setSubmitting(false);
      }
    },
    [state.trackId, submitting],
  );

  const open_ = useMemo(() => openPeriodStart(state.annotations), [state.annotations]);
  const minutesOpen = open_ ? Math.floor((tickMs - open_.tsMs) / 60_000) : 0;
  const disabled = state.trackId === null;

  const pillLabel = open_ ? `⏺ open period — ${minutesOpen} min` : '+ marker';
  const pillTitle = disabled
    ? 'No active track — wait for GPS'
    : open_
      ? `Open period since ${new Date(open_.tsMs).toISOString().slice(11, 19)}Z`
      : 'Drop a marker on the active track';
  const pillClass = open_
    ? 'bg-amber-500/85 text-slate-900 border-amber-600 hover:bg-amber-400'
    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';

  return (
    <div className={`absolute ${position} z-20 flex flex-col items-end gap-2`}>
      {flash && (
        <div className="text-xs px-2 py-1 rounded bg-slate-900/90 text-slate-100 border border-slate-700 shadow">
          {flash}
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={pillTitle}
          className={`px-3 py-1.5 text-sm rounded border shadow ${disabled ? 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed' : pillClass}`}
        >
          {pillLabel}
        </button>
      )}
      {open && (
        <div className="w-[280px] bg-slate-900/95 border border-slate-700 rounded shadow-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Drop a marker</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
              aria-label="close"
            >
              ✕
            </button>
          </div>

          {open_ && (
            <button
              type="button"
              onClick={() => void post('End period', 'periodEnd')}
              disabled={submitting}
              className="w-full px-3 py-2 text-sm font-semibold rounded border bg-amber-500/90 text-slate-900 border-amber-600 hover:bg-amber-400 disabled:opacity-50"
            >
              End period ({minutesOpen} min)
            </button>
          )}

          {[0, 1, 2].map((rowIdx) => (
            <div key={rowIdx} className="flex flex-wrap gap-1">
              {QUICK_BUTTONS.filter((b) => b.row === rowIdx).map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => void post(b.label, 'event')}
                  disabled={submitting}
                  className="px-2 py-1 text-xs rounded border bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 disabled:opacity-40"
                >
                  {b.label}
                </button>
              ))}
            </div>
          ))}

          {!open_ && (
            <button
              type="button"
              onClick={() => void post('Start period', 'periodStart')}
              disabled={submitting}
              className="w-full px-3 py-1.5 text-xs rounded border bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              Start period
            </button>
          )}

          <div className="space-y-1 pt-1 border-t border-slate-800">
            <label className="text-xs text-slate-400">Custom</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="label"
                disabled={submitting}
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded disabled:opacity-40"
              />
              <select
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value as TrackAnnotation['kind'])}
                disabled={submitting}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-1 py-1 rounded disabled:opacity-40"
              >
                <option value="event">event</option>
                <option value="periodStart">period start</option>
                <option value="periodEnd">period end</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (customLabel.length > 0) void post(customLabel, customKind);
                }}
                disabled={submitting || customLabel.length === 0}
                className="px-2 py-1 text-xs rounded border bg-slate-700 text-slate-100 border-slate-600 hover:bg-slate-600 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/AnnotationDropper.tsx
git commit -m "feat(web): AnnotationDropper floating widget

Collapsed pill with title; expands to a panel of quick buttons
(Tack/Gybe/Reef/Main/J1-3/Spinnaker), a Start-or-End period button,
and a custom-label input with a kind toggle. Polls
GET /api/tracks/active/annotation every 30 s; updates state from
each POST response. When an open period exists, the pill turns amber
and the panel promotes a prominent 'End period (N min)' button at
the top."
```

---

## Task 6: Mount on `/chart` and `/helm`

**Files:**

- Modify: `packages/web/src/app/chart/page.tsx`
- Modify: `packages/web/src/app/helm/page.tsx`

- [ ] **Step 1: Mount on `/chart`**

In `packages/web/src/app/chart/page.tsx`, near the top component imports (alongside the other chart-component imports), add:

```ts
import { AnnotationDropper } from '../../components/AnnotationDropper';
```

Find the existing `<LayersControl ... />` mount inside the chart's `<div className="relative">` wrapper. Immediately AFTER the `<LayersControl ... />` JSX block, add:

```tsx
<AnnotationDropper position="top-2 right-14" />
```

This positions the dropper to the LEFT of the NOAA layers button (which sits at `top-2 right-2`).

- [ ] **Step 2: Mount on `/helm`**

In `packages/web/src/app/helm/page.tsx`, near the top component imports, add:

```ts
import { AnnotationDropper } from '../../components/AnnotationDropper';
```

Find the outermost wrapper that contains the helm page's content. If that wrapper is already positioned (`relative`), mount the dropper inside it at `top-2 right-2`. If it's not `relative`, wrap the existing top-level element so the absolute-positioned dropper anchors correctly. The exact insertion line will depend on the existing structure — read the file before editing.

Add this JSX as a child of the (newly-`relative` if needed) wrapper:

```tsx
<AnnotationDropper position="top-2 right-2" />
```

- [ ] **Step 3: Verify nothing else changed**

```bash
git diff --stat
```

Expected: two files changed, small additions only. No layer/component mounts removed, no `<Map/>` props altered, no helm tile reordered.

- [ ] **Step 4: Typecheck and full test suite**

```bash
npm run typecheck --workspace @g5000/web
npm test
```

Expected: clean typecheck. Tests: ~700+ passing (3 new test files added in T1/T3/T4); ~4 known environmental failures (wgrib2, ConfigStore-not-booted, coastline data) acceptable per CLAUDE.md.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/page.tsx packages/web/src/app/helm/page.tsx
git commit -m "feat(web): mount AnnotationDropper on /chart and /helm

/chart: anchored top-2 right-14 to clear the NOAA layers button.
/helm: anchored top-2 right-2 (no collision)."
```

---

## Task 7: `/tracks` page annotations + slice viewer

**Files:**

- Modify: `packages/web/src/app/tracks/page.tsx`

Add an "Annotations" disclosure per track that lists annotations chronologically with icons, plus a "View slice" inline panel for each completed period.

- [ ] **Step 1: Read the current `/tracks/page.tsx`**

```bash
sed -n '1,80p' packages/web/src/app/tracks/page.tsx
sed -n '81,160p' packages/web/src/app/tracks/page.tsx
```

Identify the existing per-track row structure. Find the existing `TrackMeta` interface — it currently has `id, number, label, startedAt, endedAt, pointCount, totalDistanceM`. It does NOT yet carry annotations because the page fetches `listTracks()` which returns metadata only.

You'll need to fetch full Track data on-demand when the user expands an Annotations disclosure (otherwise listing pages would carry the full points arrays for every track — expensive). Add a per-track state for "loaded annotations".

- [ ] **Step 2: Add the disclosure UI**

Inside `packages/web/src/app/tracks/page.tsx`, near the existing TrackMeta interface, add:

```ts
import type { TrackAnnotation } from '../../lib/tracks';

interface SliceData {
  points: Array<{ t: number; lat: number; lon: number }>;
  annotations: TrackAnnotation[];
}
```

In the page component, add per-track expanded-state and loaded-annotations state:

```tsx
const [expanded, setExpanded] = useState<Record<string, boolean>>({});
const [loadedAnnotations, setLoadedAnnotations] = useState<Record<string, TrackAnnotation[]>>({});
const [openSlice, setOpenSlice] = useState<{
  trackId: string;
  fromMs: number;
  toMs: number;
  fromLabel: string;
  toLabel: string;
} | null>(null);
const [sliceData, setSliceData] = useState<SliceData | null>(null);

const toggleExpand = async (id: string): Promise<void> => {
  const nowOpen = !(expanded[id] ?? false);
  setExpanded((e) => ({ ...e, [id]: nowOpen }));
  if (nowOpen && !loadedAnnotations[id]) {
    const res = await fetch(`/api/tracks/${id}`);
    if (!res.ok) return;
    const body = (await res.json()) as {
      ok: boolean;
      track: { annotations?: TrackAnnotation[] } | null;
    };
    setLoadedAnnotations((m) => ({ ...m, [id]: body.track?.annotations ?? [] }));
  }
};

const loadSlice = async (
  trackId: string,
  fromMs: number,
  toMs: number,
  fromLabel: string,
  toLabel: string,
): Promise<void> => {
  setOpenSlice({ trackId, fromMs, toMs, fromLabel, toLabel });
  setSliceData(null);
  const res = await fetch(`/api/tracks/${trackId}/slice?from=${fromMs}&to=${toMs}`);
  if (!res.ok) return;
  const body = (await res.json()) as SliceData;
  setSliceData(body);
};

const downloadSlice = (): void => {
  if (!sliceData || !openSlice) return;
  const blob = new Blob([JSON.stringify(sliceData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${openSlice.trackId}-slice-${openSlice.fromMs}-${openSlice.toMs}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
```

Then in the per-track render (inside the existing track list iteration), add an Annotations disclosure below the existing summary:

```tsx
<button
  type="button"
  onClick={() => void toggleExpand(t.id)}
  className="text-xs text-slate-400 hover:text-slate-200 mt-1"
>
  {expanded[t.id] ? '▼' : '▶'} Annotations
</button>;
{
  expanded[t.id] && (
    <div className="mt-2 pl-3 border-l border-slate-800 space-y-1">
      {(loadedAnnotations[t.id] ?? []).length === 0 ? (
        <div className="text-xs text-slate-500">No annotations.</div>
      ) : (
        (loadedAnnotations[t.id] ?? []).map((ann, idx, arr) => {
          const icon = ann.kind === 'event' ? '●' : ann.kind === 'periodStart' ? '▶' : '■';
          const relMin = Math.round((ann.tsMs - new Date(t.startedAt).getTime()) / 60_000);
          const matchingEnd =
            ann.kind === 'periodStart'
              ? arr.slice(idx + 1).find((a) => a.kind === 'periodEnd')
              : null;
          return (
            <div key={`${ann.tsMs}-${ann.label}`} className="text-xs text-slate-300">
              <span className="font-mono text-slate-500 w-12 inline-block">+{relMin}m</span>
              <span className="mr-2">{icon}</span>
              <span>{ann.label}</span>
              {matchingEnd && (
                <button
                  type="button"
                  onClick={() =>
                    void loadSlice(t.id, ann.tsMs, matchingEnd.tsMs, ann.label, matchingEnd.label)
                  }
                  className="ml-2 text-slate-400 hover:text-slate-200 underline"
                >
                  View slice ({Math.round((matchingEnd.tsMs - ann.tsMs) / 60_000)} min)
                </button>
              )}
              {ann.kind === 'periodStart' && !matchingEnd && (
                <span className="ml-2 text-amber-400">open — drop an End period to close</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
```

Add the slice-viewer panel at the bottom of the page render (still inside the page component's returned JSX, but outside any per-track block):

```tsx
{
  openSlice && (
    <div className="fixed inset-0 z-30 bg-slate-950/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded shadow-xl p-4 max-w-xl w-full space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Slice: {openSlice.fromLabel} → {openSlice.toLabel}
          </h2>
          <button
            type="button"
            onClick={() => setOpenSlice(null)}
            className="text-slate-400 hover:text-slate-200 text-xs"
          >
            ✕
          </button>
        </div>
        {sliceData === null ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          <>
            <div className="text-sm text-slate-300 space-y-1">
              <div>
                Duration:{' '}
                <span className="font-mono">
                  {Math.round((openSlice.toMs - openSlice.fromMs) / 60_000)} min
                </span>
              </div>
              <div>
                Points: <span className="font-mono">{sliceData.points.length}</span>
              </div>
              <div>
                Annotations in range:{' '}
                <span className="font-mono">{sliceData.annotations.length}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={downloadSlice}
              className="w-full px-3 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Download JSON
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: clean for the file you touched.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/tracks/page.tsx
git commit -m "feat(web): /tracks gains annotations disclosure + slice viewer

Per-track Annotations disclosure (lazy-loaded — fetches the full
track only when expanded). Each annotation renders with icon
(●/▶/■), label, and relative-minutes-from-track-start. Paired
periodStart/periodEnd rows show a 'View slice' link that opens a
modal with point count, duration, and a Download JSON button using
the /api/tracks/[id]/slice endpoint."
```

---

## Task 8: Manual verification

**Files:**

- Modify: none.

End-to-end smoke on the local dev server.

- [ ] **Step 1: Free port 3000 and start the dev server**

```bash
lsof -ti :3000 2>/dev/null | xargs -r kill -9
cd /Users/gregjohnson/code/g5000/.worktrees/track-annotations
npm run dev --workspace @g5000/autopilot-server
```

Wait for `[autopilot] web UI on http://0.0.0.0:3000` in the log.

- [ ] **Step 2: /chart dropper visible and positioned correctly**

Open `http://localhost:3000/chart`. Confirm the dropper pill renders at the top-right area, immediately to the LEFT of the NOAA layers button (not overlapping it). Initial label: `+ marker` if there's an active track, otherwise disabled with a tooltip.

- [ ] **Step 3: Drop an event marker**

Click pill → panel expands. Click `Tack`. Confirm:

- Flash banner: `✓ Marked: Tack at HH:MM:SSZ`.
- Panel collapses, pill returns to `+ marker`.

- [ ] **Step 4: Start and end a period**

Open the dropper. Click `Start period`. Confirm:

- Pill turns amber, label becomes `⏺ open period — 0 min`.
- Wait 1 minute; label becomes `⏺ open period — 1 min` (driven by the 1 Hz tick).
- Open the panel again. The `End period (1 min)` button is prominent at the TOP, amber.
- Click `End period (1 min)`. Pill returns to `+ marker`.

- [ ] **Step 5: Custom label**

Open the dropper. Type `Halyard check` into the custom input. Confirm the kind selector defaults to `event`. Click `Add`. Confirm the flash banner and that the custom-text input clears.

- [ ] **Step 6: /helm dropper**

Navigate to `/helm`. Confirm the dropper renders top-right with the same state as /chart (the polling endpoint is shared). Drop a marker; navigate back to /chart and confirm the new annotation is reflected (poll lag up to 30 s).

- [ ] **Step 7: /tracks annotations disclosure + slice**

Navigate to `/tracks`. Find the active track. Click its `▶ Annotations` button to expand. Confirm:

- All annotations dropped above appear in order with icons (●/▶/■).
- The paired `Start period → End period` shows a `View slice (1 min)` link.
- Unpaired periods (if any) show `open — drop an End period to close`.

Click `View slice`. Confirm:

- Modal opens with duration / point count / annotations count.
- `Download JSON` triggers a browser file download with name like `track-001-slice-<from>-<to>.json`. Open the file and confirm it has the expected shape (`{ points: [...], annotations: [...] }`).

- [ ] **Step 8: Other pages still work**

Quick smoke of `/sensors`, `/race`, `/sails`, `/autopilot`, `/passage`, `/damping`, `/devices`. None should regress.

- [ ] **Step 9: Done — no further commit required**

The work is shippable from Task 7's commit. Stop here unless verification surfaced a bug.

---

## Self-review

**Spec coverage:**

- `TrackAnnotation` data model + `openPeriodStart` helper → Task 1 ✓
- Track shape extension + `appendAnnotation` → Task 2 ✓
- POST + GET annotation endpoint → Task 3 ✓
- Slice endpoint → Task 4 ✓
- Floating widget with quick buttons + custom text + open-period highlight + 1 Hz tick → Task 5 ✓
- Mount on /chart at top-2 right-14 → Task 6 ✓
- Mount on /helm at top-2 right-2 → Task 6 ✓
- /tracks annotations disclosure + lazy-loaded full track + paired periods + View slice modal + Download JSON → Task 7 ✓
- Manual verification list from spec → Task 8 ✓

**Placeholder scan:** none — every step has the actual code or an exact command + expected output.

**Type consistency:**

- `TrackAnnotation { tsMs, label, kind }` defined in Task 1 and used in Tasks 2, 3, 4, 5, 7. Same three fields, same `kind` union.
- `openPeriodStart(annotations)` defined in Task 1, called from `AnnotationDropper` (Task 5).
- `appendAnnotation(id, ann)` defined in Task 2, called from the POST route (Task 3).
- The slice endpoint's `{ points, annotations }` return type (Task 4) is what the /tracks slice viewer consumes (Task 7).
- Position-prop string for the dropper (`top-2 right-14` on /chart, `top-2 right-2` on /helm) — same prop, consistent shape.
