# SD-Card Wear & Data-Logging Assessment — g5000 on `sula-bassana`

Last written: 2026-07-06.

> **Evidence rule (per this repo's convention):** claims are tiered
> **Verified** (direct probe / code read), **Reported** (inferred with
> stated assumptions), **Unidentified** (couldn't determine — see
> Open Questions). Volume figures below are **Reported** estimates
> derived from the code; the raw Pi filesystem numbers that would
> confirm them are **Unidentified** because the Pi was unreachable at
> the time of writing (see § Part B).

---

## TL;DR

- **Dominant write source:** the session logger streaming raw N2K + 0183
  frames to `data/sessions/<id>.jsonl.gz` — **~130 MB/day** underway,
  continuous. Runner-up: the track recorder's full-file-rewrite pattern
  (**~80 MB/day**).
- **Total realistic write load underway:** roughly **0.2–0.5 GB/day**
  (session log + track + forecast-refresh bursts + GRIB temp files if
  `/tmp` is on the SD card).
- **Disk layout:** **Unidentified from a live probe** (Pi unreachable via
  Tailscale at write time). Codebase + prior memory strongly imply `/`
  and `~/.g5000-router` are **both on the SD card** with **no external
  storage**. This must be confirmed on the Pi.
- **Realistic SD lifespan:** at ~0.3 GB/day a decent A2 card (~30–100 TBW)
  lasts **many years** on raw endurance — but **cheap/no-name cards and
  write amplification can cut that to ~1–3 years**, and controller-level
  failure (not flash exhaustion) is the more common real-world killer.
  The worry is legitimate but the fix is cheap.
- **Top recommendation:** move the write-heavy dirs to a **USB SSD**, put
  `/tmp` on **tmpfs**, enable **SQLite WAL**, and mount with **noatime**.
  Do **not** stand up a cloud Postgres for live logging — it can't work
  offshore.
- **"Postgres for every parameter":** the _local_ version is defensible
  (TimescaleDB or, more proportionately, keep the existing
  session-`.jsonl.gz` as the raw tier). At full sensor rate it's
  ~130–400 MB/day of time-series — a companion datastore is only worth it
  if you actually want SQL-queryable history. A remote/cloud Postgres is
  a non-starter at sea.

---

## Part A — What writes to disk (from the codebase)

All figures are **Reported** estimates from reading the code, at "typical
Sula underway" traffic (~150 CAN frames/s from 3 apparent-wind sources +
GPS/heading at ~10 Hz + depth/AIS/log). Actual bus rate is an open item.

### The write ledger

| Path                                          | What writes it                                                                         | Cadence                                                      | Est. MB/day                          | Wear                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ | -------------------------------- |
| `data/sessions/<id>.jsonl.gz`                 | `startSessionLogger()` — `packages/bridge/src/persistence/session-logger.ts`           | **Continuous**, per-frame `gzip.write()`, no app-level batch | **~130** underway                    | **HIGH**                         |
| `~/.g5000-router/tracks/track-NNN.json`       | `writeTrack()`/`appendPoint()` — `packages/web/src/lib/tracks.ts`, `track-recorder.ts` | Every 5–60 s, **full-file rewrite** (`.tmp`+rename)          | **~80**                              | **MED-HIGH**                     |
| `/tmp/g5000-grib-*/` (GRIB2 processing)       | `wind-fetch.ts` / `hrrr-fetch.ts` `mkdtemp`→write→`grib_get_data`→`rm -rf`             | Per forecast fetch (~3 h timer)                              | 50–200 transient **if `/tmp` on SD** | **MED-HIGH (avoidable)**         |
| `~/.g5000-router/wind-cache/*.json`           | `wind-cache.ts` `persist()`                                                            | Per forecast refresh (~3 h)                                  | 40–300 (model-dependent, burst)      | **MED (burst)**                  |
| `~/.g5000-router/ecmwf-global-cache/*.bin`    | `ecmwf-global-cache.ts` `writeGlobalGrid()`                                            | Per ECMWF fetch (~3 h)                                       | ~100 if enabled (burst)              | **MED (burst)**                  |
| `data/config.db` (SQLite)                     | `ConfigStore` + `ship-log.ts`, `alarms-history.ts`, `trips.ts`                         | **Event-driven**: hourly auto-log + user actions             | **< 1**                              | **LOW** (but no WAL — see below) |
| `~/.g5000-router/weather-cache/*.json`        | `weather-cache.ts` `writeDisk()`                                                       | Every 10–30 min if `/forecast` open                          | ~5                                   | Negligible                       |
| `~/.g5000-router/current-cache/*.json`        | `current-fetch.ts` `PersistentCurrentCache.set()`                                      | Per CMEMS grid, 36 h TTL                                     | Negligible                           | Negligible                       |
| `~/.g5000-router/gulf-stream/north-wall.json` | `gulf-stream.ts` `writeCache()`                                                        | Every ~6 h                                                   | Negligible                           | Negligible                       |
| `~/.g5000-router/{tile,sat,enc}-cache/`       | tile proxy routes, on cache **MISS** only                                              | Near-zero offshore; burst on shore pre-warm                  | ~0 at sea                            | Negligible                       |
| `~/.g5000-router/engine-log.json`             | `engine-log.ts` `writeFile()`                                                          | User action only                                             | Negligible                           | Negligible                       |

### Notes on the two dominant writers

**1. Session logger (`~130 MB/day`, dominant).**
`startSessionLogger()` subscribes to every driver's `rxCan` / `rx0183`
observable and calls `gzip.write()` **synchronously per frame** — no
timer, no application-level batch between frames and the gzip stream.
Node's `WriteStream` and zlib buffer internally (flushes ~16–64 KB
chunks), so physical writes are moderately sized but very frequent. Each
line is `{"kind":"can","t_ns":"…","id":…,"data":"…"}` ≈ 80 B raw →
~7–10 B compressed. At ~150 frames/s → ~1.5 KB/s → **~5.4 MB/h →
~130 MB/day underway.** This is the raw-capture tier and is genuinely
useful (full replay), but it is the wear driver.

**2. Track recorder (`~80 MB/day`, runner-up).**
`appendPoint()` gates on a 5 s min interval + 100 m distance + 60 s force
interval, but **each write rewrites the entire track file** via
`.tmp`+rename. A 24 h track grows to ~115 KB; average write size across
the day is ~57 KB × ~1440 writes/day ≈ **~80 MB/day of raw bytes** for
~115 KB of actual data — pure full-rewrite amplification. Live-mode
gated (no demo/replay writes).

### What does NOT write to disk (good)

- **Channel history** (`apps/g5000/src/channel-history.ts`) — in-memory
  ring buffers only.
- **SOG/COG/HDG/motion stats** (`sog-stats.ts`, `cog-stats.ts`,
  `hdg-stats.ts`, `motion-stats.ts`) — in-memory rolling windows only.
  There is **no** high-frequency persistence of derived nav data to
  SQLite. Good — that's exactly the thing that would murder an SD card.

### SQLite is not in WAL mode

**Verified from code:** there is no `PRAGMA journal_mode=WAL` anywhere.
better-sqlite3 defaults to `DELETE` journal mode, so each commit writes
the data page **and** a rollback journal — ~2× write amplification per
transaction, plus journal-file create/delete churn. config.db write
_volume_ is tiny (<1 MB/day), so this is a **low-severity** item, but WAL
is a one-line, free improvement and reduces the per-write amplification
and fsync pattern that is hardest on flash.

---

## Part B — The live Pi (NOT captured — Pi unreachable)

**Status: Unidentified.** At write time the Pi could not be reached for
`ssh greg@100.64.0.117`:

- **Tailscale is not running on this Mac** (only the `.app` bundle is
  installed; the daemon is stopped and needs interactive sign-in; the CLI
  isn't on `$PATH`). Port 22 to `100.64.0.117` was unreachable.
- Boat ethernet (`192.168.2.2`) / wifi (`192.168.1.232`) unreachable — not
  on the boat LAN.
- **The public URL `https://g5000.sulabassana.net` (cloudflared) IS
  reachable** — HTTP only, no SSH — so the Pi and `g5000-autopilot` are
  **up and in `live` mode** (`/api/source-mode` → `{"mode":"live"}`),
  which confirms the session logger is actively writing right now.

### What the public URL _did_ confirm (Verified)

- **Source mode = `live`** → session logger + track recorder both active.
- **Satellite tile cache** (`/api/sat-cache`): **16.5 MB used of an
  8 GB cap**, 1470 tiles. This confirms the tile/sat caches are
  effectively static and **not** a wear driver in normal use.
- `/api/sessions` returns `{"sessions":[]}` — the listing endpoint reports
  no _completed/indexed_ sessions over the public surface (does not prove
  the on-disk `sessions/` dir is empty; likely the current session is
  still open/unindexed). **Needs on-Pi `ls -lth` to confirm.**

### Diagnostics still required on the Pi (run when Tailscale is up)

Run these read-only; they close every Part-B gap:

```bash
df -h; lsblk -o NAME,SIZE,MOUNTPOINT,ROTA,TYPE,MODEL      # SD vs external, is / on SD?
findmnt /; cat /proc/mounts | grep -Ev 'tmpfs|proc|sys'   # noatime? commit=?
cat /sys/block/mmcblk0/device/name /sys/block/mmcblk0/device/manfid  # card model
mount | grep tmpfs                                         # is /tmp or /var/log tmpfs?
du -sh ~/autopilot/apps/g5000/data ~/autopilot/apps/g5000/data/config.db \
       ~/autopilot/apps/g5000/data/sessions ~/.g5000-router
ls -lth ~/autopilot/apps/g5000/data/sessions/ | head      # growth rate from mtimes+sizes
sudo journalctl --disk-usage                              # journald is another SD writer
sudo smartctl -a /dev/mmcblk0 2>&1 | head                 # usually unsupported on SD — note it
lsusb; ls /dev/sd* 2>/dev/null                            # any external disk attached?
```

**Key unknowns these resolve:** (a) is `/` and `~/.g5000-router` on the SD
card or an external disk? (b) is `/tmp` a tmpfs (GRIB churn matters only if
not)? (c) is the card an endurance/A2 card or a no-name commodity card?
(d) actual sessions-dir growth rate to validate the ~130 MB/day estimate.
(e) journald disk usage — systemd logging can quietly add tens of MB/day.

---

## Realistic SD lifespan

**Reported estimate** (pending the Part-B card model + true write rate):

- Estimated write load underway: **~0.2–0.5 GB/day** ≈ **70–180 GB/year**.
- A reputable **A2 / high-endurance** card is rated ~30–100+ TBW. At
  ~0.15 TB/year that's **decades** of flash endurance — flash wear is
  _not_ the limiting factor if the card is good.
- A **cheap/no-name** card may have effectively <10 TBW and poor wear
  levelling; combined with write amplification (full-file rewrites,
  DELETE-journal SQLite, `/tmp` on SD) real life can drop to **~1–3
  years**, and in practice **controller death / bit-rot under power-loss**
  (boat power is dirty, brownouts on engine start) kills SD cards long
  before TBW is reached. That's the real risk, and it's abrupt.

**Bottom line:** the user's worry is legitimate not because 0.3 GB/day
exhausts flash, but because (1) the card grade is unknown, (2) write
amplification is real and avoidable, and (3) SD controllers fail
ungracefully on a boat's power. Mitigation is cheap; do it.

---

## Part C — Options & recommendation (offshore-aware)

> **Hard constraint:** the boat goes offshore with **no internet**. Any
> live datastore must be **local to the boat**. A cloud Postgres (AWS RDS,
> the rbr2 `legacy-postgres`) **cannot** serve live logging at sea — it is
> only viable as an _opportunistic sync target_ (Option 3).

### Option 1 — Cheapest mitigation: USB SSD + tune the writes ✅ recommended first

Move the write-heavy paths off the SD card and reduce amplification.

- **Attach a USB SSD** (Pi 5 has USB 3.0; even a small SATA-USB or NVMe-USB
  enclosure). Put `~/.g5000-router` and `apps/g5000/data/` (sessions +
  config.db) on it. SSDs have 100–1000× the endurance of SD and fail more
  gracefully. This alone removes ~210 MB/day (session + track) from the SD.
- **`/tmp` → tmpfs** (`tmpfs /tmp tmpfs defaults,noatime,mode=1777 0 0`).
  Kills the 50–200 MB/day of transient GRIB2 files entirely (RAM-backed).
  Pi 5 has 8 GB RAM; GRIB temp files are 5–50 MB — fine.
- **`noatime`** on whatever fs holds the data dirs — removes per-read mtime
  writes (the sat-cache `bumpMtimeOnHit` and every file read).
- **SQLite WAL**: add `raw.pragma('journal_mode = WAL')` (and consider
  `synchronous = NORMAL`) right after `new Database(...)` in
  `packages/db/src/config-store.ts`. One line; cuts journal churn.
- **Optional, source-side:** add a small batch to the session logger
  (buffer ~50 frames before flush) and lengthen the track-recorder force
  interval from 60 s → 300 s (or switch track to append-NDJSON to kill the
  full-rewrite amplification).

**Does Option 1 alone solve it?** **Yes, for the wear problem.** Moving the
two dominant writers to an SSD + tmpfs for `/tmp` reduces SD writes to
"config-db + journald only" (a few MB/day), which any card survives for
many years. This is the highest value / lowest effort path. **Recommended
as Phase 1 regardless of whether you later want a datastore.**

### Option 2 — Local time-series datastore for "every parameter"

Only worth it if the goal is **SQL-queryable sensor history**, not wear
(Option 1 already solves wear). Must run **on the boat**.

Volume sanity check first: "every parameter at full rate" ≈ the same
~150 frames/s the session logger sees. As decoded/typed rows that's
~130–400 MB/day raw; with time-series compression (Timescale/Influx do
5–20×) → ~20–80 MB/day on disk. **Sane only if downsampled or you accept
the SSD.** At full fidelity you'd want the SSD anyway.

| Engine                                                                            | Pros                                                                                                                                     | Cons (on a Pi, offshore)                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL + TimescaleDB**                                                      | Real SQL, hypertables + native compression, continuous aggregates for downsampling, one query surface for the web app; runs fine on Pi 5 | Heaviest footprint (~200–400 MB RAM idle); another service to babysit; overkill if you only ever read recent windows                                   |
| **InfluxDB (v2/v3)**                                                              | Purpose-built for high-freq sensor data, best raw write efficiency, cheap retention/downsampling policies                                | Non-SQL (Flux/InfluxQL) → the Next.js app would need a second data-access path; v2 memory footprint is notable on a Pi; another daemon                 |
| **SQLite time-series** (keep in-process, add a rollup table or use `sqlite-zstd`) | Zero new service, already embedded, in-process, tiny footprint, trivial to query from the app                                            | No native TS compression/retention; you hand-roll downsampling + pruning; high-cardinality/high-freq inserts stress it (mitigated by WAL + batched tx) |

**Honest take:** the app **already has a raw tier** — the session
`.jsonl.gz` files _are_ "every parameter", replayable end-to-end, and
gzip-compressed. Standing up Timescale/Influx duplicates that unless you
specifically want **ad-hoc SQL over history** (e.g. "max TWS per hour last
month"). If that's the actual want, **TimescaleDB on the USB SSD** is the
best fit for this stack (keeps one SQL surface for the web app) — but treat
it as a **separate feature**, not the wear fix. If you don't need SQL,
**skip Option 2** and just keep the session logs on the SSD.

### Option 3 — Buffer locally, sync opportunistically

Compatible with either tier above. Log locally (SSD), and when internet
appears (in port, or Starlink up) push a rollup/aggregate to a remote
(RBR RDS or rbr2 `legacy-postgres`) for long-term archive / shore
analysis. **Never** the live path. Effort is real (idempotent sync,
watermark/cursor, backfill, conflict handling) — defer until there's a
concrete shore-analysis need. The session `.jsonl.gz` files already give
you a manual "copy off in port" story for free.

---

## Recommendation & phasing

1. **Phase 0 (now, read-only):** run the Part-B diagnostics on the Pi to
   confirm disk layout, card grade, `/tmp` fs, and true sessions-dir
   growth. This validates the estimates and may change the urgency.
2. **Phase 1 (cheap, high-value — do this):** USB SSD for
   `~/.g5000-router` + `apps/g5000/data`; `/tmp` → tmpfs; `noatime`;
   SQLite WAL. Solves the wear problem outright. ~½ day incl. testing.
3. **Phase 2 (optional, only if you want SQL history):** TimescaleDB on
   the SSD as a parallel datastore fed from the bus; add continuous
   aggregates for downsampling. A distinct feature spec, not a wear fix.
4. **Phase 3 (later):** opportunistic sync of rollups to a shore Postgres
   when internet is available. Defer until a shore-analysis need is real.

**Do NOT** point live logging at a cloud Postgres — it cannot work at sea.

---

## Open questions (couldn't determine)

- **Is `/` and `~/.g5000-router` on the SD card, or already on external
  storage?** Unreachable Pi — needs `lsblk`/`df -h`. This changes the
  whole calculus (if already on an SSD, most of this is moot).
- **Is `/tmp` a tmpfs?** Determines whether GRIB churn (50–200 MB/day)
  hits the SD at all.
- **SD card model / grade** (A2 high-endurance vs commodity) — sets the
  real TBW and thus lifespan.
- **Actual N2K bus frame rate** — the ~150 frames/s figure drives the
  ~130 MB/day session estimate; confirm from the live sessions-dir growth
  or a frame-counter.
- **journald disk usage** — systemd logging is an unmeasured SD writer;
  `journalctl --disk-usage` + whether `Storage=volatile` is set.
- **Power-loss robustness** — the real SD killer on a boat is dirty power,
  not TBW; an SSD + WAL both help, but worth a UPS/clean-shutdown note.
