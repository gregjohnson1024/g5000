import { plan } from '@g5000/routing';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { loadWindFor, loadCurrentFor } from '../../../../lib/grib-context';
import { loadDefaultCoastline } from '../../../../lib/coastline';
import { readJson } from '../../../../lib/persistence';
import { SETTINGS } from '../../../../lib/paths';
import { resolvePlanOptions, type PlanningSettings } from '../../../../lib/planning-settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  useCurrents?: boolean;
  options?: Record<string, unknown> & {
    autoMotor?: { minSail: number; motor: number };
    captureIsochrones?: boolean;
  };
}

function bboxAround(a: Body['start'], b: Body['end']) {
  const buffer = 2; // degrees
  return {
    latMin: Math.min(a.lat, b.lat) - buffer,
    latMax: Math.max(a.lat, b.lat) + buffer,
    lonMin: Math.min(a.lon, b.lon) - buffer,
    lonMax: Math.max(a.lon, b.lon) + buffer,
  };
}

function validate(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (!o.start || !o.end || typeof o.departure !== 'number') return false;
  if (typeof o.model !== 'string' || !['GFS', 'ECMWF'].includes(o.model)) return false;
  return true;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }
  if (!validate(body)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'missing required fields' } },
      { status: 400 },
    );
  }
  const b = body;
  try {
    const bbox = bboxAround(b.start, b.end);
    const wind = await loadWindFor(b.model, bbox, 120);
    let currents: CurrentField | undefined;
    if (b.useCurrents) {
      currents = await loadCurrentFor(bbox, 120);
    }
    const coastline = await loadDefaultCoastline();
    // v3 polar resolution: activePolar$ resolves to the newest PolarRevision
    // for (activeBoatId, activeMode). polarId is set to 'active' as a
    // human-readable tag; identity tracking happens via revision rows.
    const store = getSharedConfigStore();
    const polar = await firstValueFrom(store.activePolar$);
    const settings = ((await readJson(SETTINGS)) ?? {}) as { planning?: PlanningSettings };
    const resolved = resolvePlanOptions(settings.planning, b.options as never);
    const route = plan({
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar,
      polarId: 'active',
      coastline,
      currents,
      options: { ...resolved, useCurrents: !!b.useCurrents, captureIsochrones: !!b.options?.captureIsochrones },
    });
    return Response.json({ ok: true, route });
  } catch (err) {
    const e = err as { kind?: string; status?: number; retryable?: boolean; message?: string };
    return Response.json(
      {
        ok: false,
        error: {
          kind: e.kind ?? 'internal',
          message: e.message ?? String(err),
          retryable: e.retryable ?? false,
        },
      },
      { status: e.status ?? 500 },
    );
  }
}
