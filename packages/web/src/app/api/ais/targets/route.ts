import { getSharedAisTargets } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → list every currently-tracked AIS target. Targets are added/updated by
 * the bridge as 129038/129039/129040/129794/129809/129810 PGNs are decoded
 * (or by the demo injector when DEMO_MODE=1). The endpoint does NOT compute
 * CPA/TCPA — that's a client-side concern because it needs own-boat live
 * data that the client already has via SSE.
 *
 * Response: `{ targets: AisTarget[] }`. Empty when no AIS data has been
 * received yet (typical on a fresh boot before the first AIS PGN arrives).
 */
export async function GET(): Promise<Response> {
  const registry = getSharedAisTargets();
  return Response.json({ targets: registry?.all() ?? [] });
}
