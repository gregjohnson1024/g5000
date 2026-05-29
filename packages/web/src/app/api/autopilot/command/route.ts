import { getSharedAutopilotTx, type AutopilotCommandName } from '@g5000/core';
import { parseJsonBody } from '../../../../lib/req';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_EVENTS: AutopilotCommandName[] = [
  'standby',
  'auto',
  'nav',
  'wind',
  'no_drift',
  'course_+1',
  'course_-1',
  'course_+10',
  'course_-10',
];

interface Body {
  event: AutopilotCommandName;
}

/**
 * POST /api/autopilot/command — sends a PGN 130850 frame to the H5000.
 *
 * Three layers of gating, in order:
 *  1. process.env.G5000_ENABLE_AP_TX must be "1" (403 otherwise)
 *  2. The shared AutopilotTx singleton must be registered (503 otherwise)
 *  3. The command resolver / driver may still reject (200 + ok:false body)
 *
 * Body: { event: 'standby' | 'auto' | ... }. See AutopilotCommandName.
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.G5000_ENABLE_AP_TX !== '1') {
    return Response.json(
      { ok: false, error: { kind: 'forbidden', message: 'AP TX disabled in this environment' } },
      { status: 403 },
    );
  }
  const parsed = await parseJsonBody<Body>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!VALID_EVENTS.includes(body.event)) {
    return Response.json(
      {
        ok: false,
        error: { kind: 'bad_request', message: `invalid event: ${String(body.event)}` },
      },
      { status: 400 },
    );
  }
  const tx = getSharedAutopilotTx();
  if (!tx) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'unavailable',
          message: 'AP TX not registered (bridge not booted with G5000_ENABLE_AP_TX=1)',
        },
      },
      { status: 503 },
    );
  }
  const r = await tx.sendCommand({ event: body.event });
  if (r.ok) {
    return Response.json({ ok: true, txMs: r.txMs });
  }
  return Response.json({ ok: false, error: r.error }, { status: 502 });
}
