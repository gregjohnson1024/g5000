import { firstValueFrom } from 'rxjs';
import { getSharedAisTargets } from '@g5000/core';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → list every currently-tracked AIS target. Targets are added/updated by
 * the bridge as 129038/129039/129040/129794/129809/129810 PGNs are decoded
 * (or by the demo injector when DEMO_MODE=1). The endpoint does NOT compute
 * CPA/TCPA — that's a client-side concern because it needs own-boat live
 * data that the client already has via SSE.
 *
 * Targets matching `BoatConfig.selfMmsi` are dropped — we don't want to see
 * ourselves on the chart.
 */
export async function GET(): Promise<Response> {
  const registry = getSharedAisTargets();
  const targets = registry?.all() ?? [];
  const cfg = await firstValueFrom(getSharedConfigStore().boatConfig$);
  const self = cfg.selfMmsi;
  const filtered = typeof self === 'number' ? targets.filter((t) => t.mmsi !== self) : targets;
  return Response.json({ targets: filtered });
}
