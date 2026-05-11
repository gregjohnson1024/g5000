# Sessions Browser + Replay Control — Design

**Date:** 2026-05-11
**Status:** Approved, ready for implementation planning
**Scope:** §10 step 9 (replay driver) + §8.2 `/sessions` page from the G5000 master spec

## 1. Problem

Plan 2 shipped two things that are currently invisible to the user:

- `startSessionLogger()` writes a per-session `<dir>/<sessionId>.jsonl.gz` containing
  CAN frames and 0183 sentences with bigint `t_ns` timestamps.
- `ReplayDriver` is a full `WireDriver` implementation that streams a log back
  out to the bus, in either `realtime` (paced by recorded `t_ns`) or `asap`
  mode.

Neither is wired into the running server. There is no UI to browse, download,
or replay a session. This blocks the master spec's "develop ashore against
captured boat data" workflow — and that workflow is the test vehicle for the
work that follows (shadow autopilot, leeway Kalman).

## 2. Goal

The user can:

1. See a list of recorded sessions in the web UI with header + size + duration.
2. Download a session file.
3. Press "Replay" and have the recording drive the bus — true-wind pipeline,
   helm dashboard, polar plot, BSP/compass cal pages all show the recorded
   values exactly as if they were live.
4. Stop a replay and return to whatever source was running before.
5. See clearly in the navbar that the bus is being driven by a replay (not
   live, not demo).

## 3. Existing pieces (do not rebuild)

- `packages/bridge/src/persistence/session-logger.ts` — write path, file
  format, header line.
- `packages/bridge/src/persistence/replay-driver.ts` — `ReplayDriver` class
  implementing `WireDriver`; `start()`, `stop()`, `rxCan`, `rx0183`, `health`.
  TX methods throw (replay is read-only).
- `apps/autopilot-server/src/index.ts` — boots either the live `NgtDriver` or
  the `demo-injector` based on `process.env.DEMO_MODE`.

## 4. New pieces

### 4.1 Source-mode controller (server-side)

A `globalThis`-backed singleton in `apps/autopilot-server/src/source-mode.ts`
that owns which "source" is currently driving the bus:

```ts
type SourceMode = 'live' | 'demo' | 'replay';
type ReplayStatus = {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  status?: 'running' | 'finished' | 'error';
  processedLines?: number;
  startedAt?: string;
  errorMessage?: string;
};

interface SourceModeController {
  getStatus(): ReplayStatus;
  startReplay(args: { sessionId: string; paceMode: 'realtime' | 'asap' }): Promise<void>;
  stopReplay(): Promise<void>;
}
```

Lifecycle on `startReplay`:

1. Refuse if a replay is already running.
2. Tear down the current source (if live: nothing to do for read-only NGT-1
   driver; if demo: stop the demo interval).
3. Construct a `ReplayDriver`, wire it through the same `decoder` + channel
   mappers + bridge that live data uses, so identical channels appear on the
   shared `Bus`.
4. Track `processedLines` by subscribing to `rxCan` / `rx0183` count.
5. When the file is exhausted, set `status: 'finished'` but do NOT auto-restore
   the prior source — leave the user in control.

Lifecycle on `stopReplay`: call `ReplayDriver.stop()`, set mode back to what it
was (re-arm demo injector or NGT-1 driver if it was running).

For Phase-0a from-home use we accept that replay is mutually exclusive with
live and demo. We don't model "live + replay overlay".

### 4.2 N2K TX gating during replay

Per master spec §5: "TX sandboxed to a write-to-file sink instead of the bus".
First iteration is simpler — `txCan`, `tx0183`, and `txPgn` short-circuit when
`sourceMode.getStatus().mode === 'replay'`. No file sink yet; we just don't
transmit. The autopilot pipeline (when it lands) MUST respect this gate.

The true-wind TX (already shipping calibrated 130306 in live mode) also
short-circuits during replay so we don't re-broadcast onto a non-existent bus
on the dev machine.

### 4.3 Sessions REST API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/sessions` | — | `{ sessions: SessionInfo[] }` |
| GET | `/api/sessions/[id]` | — | `SessionSummary` |
| GET | `/api/sessions/[id]/download` | — | binary stream of the .jsonl.gz |
| DELETE | `/api/sessions/[id]` | — | `{ ok: true }` |
| POST | `/api/replay/start` | `{ sessionId, paceMode }` | `ReplayStatus` |
| POST | `/api/replay/stop` | — | `ReplayStatus` |
| GET | `/api/replay/status` | — | `ReplayStatus` |

```ts
type SessionInfo = {
  id: string;          // filename without .jsonl.gz
  sizeBytes: number;
  mtime: string;       // ISO
  startedAt?: string;  // from header line
};

type SessionSummary = SessionInfo & {
  canLines: number;
  otLines: number;
  durationMs: number;
  firstEventNs?: string;
  lastEventNs?: string;
};
```

`SessionSummary` requires scanning the file. Cache the result keyed by `id +
mtime`. Don't decompress on every list request; the cheap `/api/sessions`
endpoint only reads the header line.

### 4.4 `/sessions` page

A new page under `packages/web/src/app/sessions/`:

- Top: header banner showing current `ReplayStatus` (or "Live" / "Demo").
- Table: sessions sorted newest-first, columns
  `[Session ID, Started At, Size, Sample counts (lazy), Actions]`.
- Per-row actions: `[Download] [Replay 1×] [Replay fast] [Delete]`.
- Clicking a row expands the row to show counts + duration once `GET
  /api/sessions/[id]` returns.
- During an active replay, the action buttons are disabled on all rows except
  the active one (which shows `[Stop]`).

Live-poll the replay status every 1 s via `fetch('/api/replay/status')`
(simpler than SSE for a status chip). When status is `running`, also subscribe
to the existing `/api/stream` SSE so the page can show a sample-arrival
indicator.

### 4.5 Navbar source-mode chip

Replace the current `DEMO` chip (which is binary: visible iff `DEMO_MODE=1`)
with a tri-state chip backed by `GET /api/source-mode`:

- `LIVE`  — green
- `DEMO`  — amber
- `REPLAY: <session-id>` — purple, also acts as a link to `/sessions`

The existing `/api/dev/demo` endpoint is replaced by `/api/source-mode`.
Update the navbar's fetch site.

## 5. Out of scope (deferred)

- TX-to-file sandbox (we only gate; we don't capture commanded TX).
- Seek/scrub inside a replay (start/stop only for now).
- Replay speed ramps beyond `realtime` and `asap`.
- Parallel "live + replay overlay" for diff workflows — that belongs with
  shadow-autopilot parity diffing.
- Streaming a replay to a remote client (only the local server replays).
- Per-channel filter on what gets replayed.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Replay drives the bus *and* the live NGT-1 simultaneously, doubling values | Make mode exclusive; tear down the live driver before starting replay |
| TX to a real N2K bus during replay re-broadcasts stale values | TX short-circuit gated on `mode === 'replay'` |
| Large session files block the API thread when we count lines | Cache summaries on `(id, mtime)`; do the scan once per file lifetime |
| `globalThis` controller diverges across Turbopack module copies (same bug we hit with Bus) | Use the same `globalThis.__g5000_sourceMode__` pattern |

## 7. Testing strategy

- Unit tests for `SourceModeController`: state machine, refuse-double-start,
  finished-doesn't-restart.
- Unit tests for the session-summary scanner against a tiny fixture log
  generated in-test by `startSessionLogger`.
- API route tests for `/api/sessions` + `/api/replay/start/stop` using vitest
  + a temp directory.
- Manual: browser-test the `/sessions` page in DEMO_MODE — record a short
  session via the existing logger (already running), then replay it and watch
  the helm dashboard repeat.
