import {
  getSharedConfigStore,
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
} from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/config/reset-calibrations
 *
 * Resets the three per-sensor calibration tables to identity defaults:
 *   - AWS/AWA wind calibration grid (zero corrections, unity multipliers)
 *   - BSP (boat speed) multiplier table (1.0 at every bin)
 *   - Compass deviation table (zero at every 10° bin)
 *
 * Does NOT touch BoatConfig, polars, damping config, sail wardrobe, source
 * priority rules, or AIS alarm config — those are settings, not calibrations.
 * Destructive, no body required.
 */
export async function POST(): Promise<Response> {
  const store = getSharedConfigStore();
  await store.setAwsAwaCal(DEFAULT_AWS_AWA_CAL);
  await store.setBspCal(DEFAULT_BSP_CAL);
  await store.setCompassDeviation(DEFAULT_COMPASS_DEVIATION);
  return Response.json({ ok: true });
}
