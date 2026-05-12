import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type AisAlarmConfig } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → current AIS CPA-alarm thresholds.
 * Shape: `{ enabled: boolean, cpaMeters: number, tcpaSeconds: number }`.
 */
export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cfg = await firstValueFrom(store.aisAlarmConfig$);
  return Response.json(cfg);
}

/**
 * PUT replaces the whole AIS alarm config.
 *
 * Body: `{ enabled?: boolean, cpaMeters?: number, tcpaSeconds?: number }`.
 * Partial bodies are merged with the existing config. The store performs
 * type + finite + positivity validation; we return 422 on failure.
 */
export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'expected JSON object' }, { status: 422 });
  }
  const current = store.getAisAlarmConfig();
  const partial = body as Partial<AisAlarmConfig>;
  const next: AisAlarmConfig = {
    enabled: partial.enabled ?? current.enabled,
    cpaMeters: partial.cpaMeters ?? current.cpaMeters,
    tcpaSeconds: partial.tcpaSeconds ?? current.tcpaSeconds,
  };
  try {
    await store.setAisAlarmConfig(next);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
  return Response.json(next);
}
