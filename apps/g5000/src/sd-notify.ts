import { spawn } from 'node:child_process';

/**
 * Minimal sd_notify(3) client. systemd sets `$NOTIFY_SOCKET` and exports
 * `$WATCHDOG_USEC` to a service launched with `Type=notify` + `WatchdogSec=`.
 * The daemon writes newline-delimited key=value pairs to the socket; the
 * two we use:
 *   - `READY=1`    — sent once after init; lets the service exit
 *                    "activating" and become "active".
 *   - `WATCHDOG=1` — heartbeat ping. If systemd doesn't see one inside
 *                    `WatchdogSec`, it kills the service (Restart=
 *                    policy brings it back).
 *
 * Implementation: Node's `dgram` doesn't support Unix datagram sockets
 * (only UDP), so we shell out to the `systemd-notify` CLI — pre-installed
 * on every systemd host. Each invocation is cheap (~1 ms) and we ping at
 * half the watchdog interval, so this is well below any cost concern.
 * When `$NOTIFY_SOCKET` is unset (foreground dev runs), every call is a
 * no-op.
 */

const NOTIFY_SOCKET = process.env.NOTIFY_SOCKET ?? '';

function send(arg: string): void {
  if (!NOTIFY_SOCKET) return;
  const child = spawn('systemd-notify', [arg], { stdio: 'ignore' });
  child.on('error', () => {
    /* binary missing; sd_notify silently no-ops */
  });
}

export function notifyReady(): void {
  send('--ready');
}

export function notifyWatchdog(): void {
  // `systemd-notify WATCHDOG=1` — newer CLIs accept this; older ones use
  // `--status=`. The key=value form works on every Debian/Pi build I've
  // seen so far. If this ever breaks, fall back to writing the message
  // via a tiny Python or socat one-liner.
  send('WATCHDOG=1');
}

/**
 * Start a periodic WATCHDOG=1 ping. Interval is read from
 * `$WATCHDOG_USEC` (systemd exports it as microseconds) and halved so we
 * have headroom — i.e. if WatchdogSec=60, we ping every 30 s. Returns a
 * teardown function. Outside systemd this is a no-op.
 */
export function startWatchdog(): () => void {
  const usec = Number(process.env.WATCHDOG_USEC ?? 0);
  if (!Number.isFinite(usec) || usec <= 0) return () => {};
  const intervalMs = Math.max(1000, Math.floor(usec / 1000 / 2));
  const id = setInterval(() => notifyWatchdog(), intervalMs);
  return () => clearInterval(id);
}
