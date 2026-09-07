# Diagnosing Sula

Written 2026-09-07, after a day in which six separate faults were found on the
boat and **every one of them was the same mistake**. This is not a list of
gotchas — `network-map.md` has those. It is the one rule that would have saved
most of that day.

---

## The rule

> **A signal that is true is not necessarily the thing you care about.**
> Check the artifact, not the supervisor's intent.

Every fault below reported healthy. Not silent, not erroring — **healthy**. The
signal was accurate about the question it actually answers, and we read it as
the answer to the question we had.

| What we read                           | What we assumed                         | What was true                                                                                                               |
| -------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `systemctl is-enabled` → `enabled`     | the deploy runner is running            | dead for a day; the unit shipped `Restart=no`, so `enabled` only ever meant "start at boot"                                 |
| `systemctl is-active` → `active`       | the mast panel is displaying            | blank screen; Chromium exited instantly on a stale `SingletonLock` and the wrapper's `\|\| true` swallowed it               |
| `systemctl is-active` → `active`       | one kiosk is running                    | two loops fighting over one profile; `PAMName=login` moves them outside the service cgroup, so `stop` kills an empty cgroup |
| established TCP sockets after a deploy | the page is running the new code        | the SSE stream had reconnected; the **page** had not reloaded and was hours stale                                           |
| an ARP entry resolves                  | the host is reachable                   | macOS Local Network privacy was blocking every peer; ARP is below that policy                                               |
| `pgrep -f <pattern>` matched           | the target process was found            | it matched the SSH shell's own command line — five separate incidents                                                       |
| a config value changed                 | unexplained drift, logged as an anomaly | Greg had changed it. Nobody asked him                                                                                       |

The last row is the sharpest. There was no signal to misread at all — only a
question we hadn't asked, and it reached a published document as an open anomaly
before anyone checked.

---

## Why the rule pays

**The measurement was always available and always cheap.** Chromium's start
time. `/proc/PID/exe`. A screenshot. The Pi's `HEAD` against `origin/main`. One
question to the person standing next to the hardware.

Seconds each. Every wrong conclusion cost between twenty minutes and an hour.
That asymmetry, not the principle, is the argument.

**Corollary — when you cannot measure, decline rather than assume.** This is why
`BuildIdWatcher`'s reload budget fails closed when `sessionStorage` is
unavailable: without it no counter survives a reload, so nothing can bound a
loop, and an unattended display reloading forever is worse than a stale one.

---

## Instruments

Reach for the right-hand column.

| Question                         | Don't trust                | Measure                                                 |
| -------------------------------- | -------------------------- | ------------------------------------------------------- |
| Is the service doing its job?    | `is-active` / `is-enabled` | the artifact — pixels, a request served, a file written |
| Is the display showing anything? | the unit state             | `grim` a frame and **look at it** (see below)           |
| Is exactly one instance running? | `pgrep -c` >0              | assert **exactly 1**; 0 and 2+ are both failures        |
| Which process is this really?    | command-line text          | `/proc/PID/exe` — kernel-maintained, unforgeable        |
| Did the deploy land?             | a green push               | the target's `HEAD`, and its `BUILD_ID`                 |
| Is the page running new code?    | live data, open sockets    | the browser's start time vs the commit time             |
| Is this host reachable?          | an ARP entry               | an actual ICMP or TCP response                          |
| Why did this value change?       | inference                  | **ask the person who can reach it**                     |

### Capturing the mast panel

```sh
ssh pi@10.10.10.11 \
  'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim -s 0.4 /tmp/f.png'
scp pi@10.10.10.11:/tmp/f.png .
```

**View the frame.** Do not infer from its byte size: black and white canvases
compress almost identically (17.3 KB vs 18.7 KB measured), so size separates
_themes_ but not _colours_. Capturing pixels is the only check that caught the
`--mast-fg` bug, which had survived months of the control appearing to work.

---

## Process-matching traps

Seven incidents in one day between two sessions. This is not carelessness — it
is that every convenient "is X running" tool matches on strings that something
else controls: your own shell's `argv`, Chromium's rewritten process title, an
admin's SSH command.

**The rule:** never put a process-matching pattern in the same command as
anything else, and never inside a `bash -c` string.

- `pkill -f "foo"` over SSH kills **your own shell** when your command line
  contains `foo`. It killed a session mid-script twice, once leaving
  `mast-display` stopped. Use `pkill foo` (process _name_) instead.
- If you must match by pattern, split the literal so your own command line never
  contains it: `P="mast-kiosk""-run.sh"; pgrep -f "$P"`.
- **Chromium rewrites its `argv` into one flat space-separated string** with no
  NUL separators, so positional parsing sees the whole line as `argv[0]` and
  matches nothing — silently reporting zero browsers for a running browser.
  `bash` does not do this, so runner detection works while browser detection
  quietly fails. Identify by `/proc/PID/exe`.
- `set -o pipefail` plus `grep -q`: `grep` exits on first match, the writer takes
  `SIGPIPE` (141), and the pipeline reports **failure on success**. This restarted
  a healthy kiosk.

---

## Watchdogs

A watchdog that restarts what it watches is a loaded weapon pointed at
production. Both watchdog bugs found here fired on _healthy_ systems.

- Its detection must not be contaminable by the operator. A liveness check that
  `pgrep -f`'d its own runner path restarted the kiosk because an admin typed a
  filename.
- Give it a dry-run mode so tests can never bounce production.
- Bound the **total**, not just the rate. A 30-second window still permits
  reloading twice a minute forever; a display that does that is broken, just
  slowly. Cap the total and reset the counter only on a genuine success.
- Take it out of the loop before running the decisive test, rather than arguing
  it probably would not have interfered.

---

## See also

- `network-map.md` — topology, per-device detail, and the network-specific
  gotchas (Tailscale subnet routes answering from Ottawa; macOS Local Network
  privacy; `ping -W` on macOS being **milliseconds**, so short timeouts report
  ARP entries as live hosts).
- `deploy-runner.md` — the self-hosted runner. It now carries
  `Restart=always` via a drop-in; without it a dead runner queues pushes
  indefinitely while `main` looks shipped.
