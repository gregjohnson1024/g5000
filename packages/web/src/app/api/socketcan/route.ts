import {
  getSharedDriverHub,
  SocketCanDriver,
  createSocketCanRawChannelFactory,
} from '@g5000/bridge';
import { SETTINGS } from '../../../lib/paths';
import { readJson, writeJson } from '../../../lib/persistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Hot-toggle the SocketCAN ingest driver without restarting the
 * g5000 app. The handler:
 *   1. Persists `{ enabled, interface }` to ~/.g5000-router/settings.json
 *      so the choice survives the next restart.
 *   2. Adds or removes the SocketCAN driver via the shared DriverHub so
 *      the change takes effect this instant.
 *
 * The DriverHub label `socketcan` is the contract here — anything that
 * wants to inspect or remove this driver later (boot-time wiring,
 * /settings UI, /sources page) keys on that label.
 */
const HUB_LABEL = 'socketcan';

interface SocketCanState {
  enabled: boolean;
  interface: string;
  /** Whether the driver is currently in the hub. May differ from `enabled`
   *  if the driver failed to start (e.g. `socketcan` module missing). */
  running: boolean;
}

function readPersistedState(parsed: unknown): { enabled: boolean; interface: string } {
  if (parsed && typeof parsed === 'object') {
    const sc = (parsed as { socketCan?: { enabled?: unknown; interface?: unknown } }).socketCan;
    if (sc && typeof sc === 'object') {
      return {
        enabled: sc.enabled === true,
        interface:
          typeof sc.interface === 'string' && sc.interface.length > 0 ? sc.interface : 'can0',
      };
    }
  }
  return { enabled: false, interface: 'can0' };
}

async function currentState(): Promise<SocketCanState> {
  const settings = (await readJson(SETTINGS)) ?? {};
  const persisted = readPersistedState(settings);
  const hub = getSharedDriverHub();
  return {
    ...persisted,
    running: hub?.hasDriver(HUB_LABEL) ?? false,
  };
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, state: await currentState() });
}

interface PostBody {
  enabled?: boolean;
  interface?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }

  if (typeof body.enabled !== 'boolean') {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: '`enabled` must be a boolean' } },
      { status: 400 },
    );
  }

  const desiredEnabled = body.enabled;
  const desiredInterface =
    typeof body.interface === 'string' && body.interface.trim().length > 0
      ? body.interface.trim()
      : 'can0';

  // Persist first so a hub-add failure (e.g. socketcan module missing on
  // Mac dev) still records the operator's intent. Settings stay merged
  // with whatever else is in settings.json — we only touch `.socketCan`.
  const existing = ((await readJson(SETTINGS)) ?? {}) as Record<string, unknown>;
  existing.socketCan = { enabled: desiredEnabled, interface: desiredInterface };
  await writeJson(SETTINGS, existing);

  const hub = getSharedDriverHub();
  if (!hub) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'unavailable',
          message: 'DriverHub not initialised — g5000 app is starting up or in a test harness',
        },
      },
      { status: 503 },
    );
  }

  // Compute the diff between current and desired hub state.
  const alreadyRunning = hub.hasDriver(HUB_LABEL);

  // Disable path — easy case.
  if (!desiredEnabled) {
    if (alreadyRunning) {
      await hub.removeDriver(HUB_LABEL);
    }
    return Response.json({ ok: true, state: await currentState() });
  }

  // Enable path. If the interface changed while it was running, restart
  // the driver (stop + start) so the new interface takes effect. Same
  // codepath handles "wasn't running yet".
  if (alreadyRunning) {
    await hub.removeDriver(HUB_LABEL);
  }
  try {
    const driver = new SocketCanDriver({
      channelFactory: createSocketCanRawChannelFactory(desiredInterface),
    });
    await hub.addDriver(HUB_LABEL, driver);
  } catch (err) {
    // Driver failed to start. Persisted state stays `enabled: true` so
    // the next restart can retry; live state reflects "not running".
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'driver_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        state: await currentState(),
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, state: await currentState() });
}
