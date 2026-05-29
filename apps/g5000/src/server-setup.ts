import http from 'node:http';
import next from 'next';
import type { Bus } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import { startHlinkServer, type HlinkServerHandle } from './hlink/server.js';
import { notifyReady } from './sd-notify.js';

const DEV = process.env.NODE_ENV !== 'production';

/**
 * H-LINK TCP server — B&G ASCII protocol over TCP, read-only. Exposes bus
 * data to tactical-sailing software (Deckman, Expedition plugins, etc.) by
 * mimicking the H5000 CPU's serial interface. Spec on serial is 115200/8N1;
 * we use TCP because every modern client supports it just as well.
 *
 * The HLINK_ENABLED gate, the `await handle.listening`, the success/failure
 * logging, and the teardown registration stay at the call site in main().
 */
export function startHlink(deps: {
  bus: Bus;
  store: ConfigStore;
  port: number;
}): HlinkServerHandle {
  const { bus, store, port } = deps;
  return startHlinkServer({
    bus,
    port,
    host: '0.0.0.0',
    // Cheap sync read of the current damping config on every sample.
    // ConfigStore keeps a BehaviorSubject under the hood; `.value` access.
    getDamping: () => store.getDampingConfig(),
  });
}

/**
 * Start Next.js pointing at the @g5000/web package directory and listen on
 * the HTTP port. `notifyReady()` and the track-recorder kick fire INSIDE the
 * listen callback — only once the socket is actually bound — so systemd
 * doesn't flip to "active" until the HTTP listener exists.
 */
export async function startWebServer(opts: { webDir: string; port: number }): Promise<http.Server> {
  const { webDir, port } = opts;
  const app = next({ dev: DEV, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[autopilot] web UI on http://0.0.0.0:${port}`);
    // Tell systemd we're done initialising. Required under Type=notify;
    // no-op when run standalone. Sent here (not earlier) so systemd
    // doesn't flip to "active" until the HTTP listener actually exists.
    notifyReady();
    // Wake the track recorder. It only starts on the first hit to
    // /api/tracks/active — without this kick, a service restart leaves
    // it idle until someone opens the chart page, and the boat
    // moves with no track points appended. Fire-and-forget; failures
    // are non-fatal (next page visit will wake it anyway).
    setTimeout(() => {
      fetch(`http://127.0.0.1:${port}/api/tracks/active`)
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('[autopilot] track recorder kicked');
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[autopilot] track recorder kick failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }, 2000);
  });
  return server;
}
