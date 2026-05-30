import { plan, planVia } from '@g5000/routing';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { loadWindFor, loadCurrentFor } from '../../../../lib/grib-context';
import { loadDefaultCoastline } from '../../../../lib/coastline';
import { readJson } from '../../../../lib/persistence';
import { SETTINGS } from '../../../../lib/paths';
import { resolvePlanOptions, type PlanningSettings } from '../../../../lib/planning-settings';
import { parseJsonBody } from '../../../../lib/req';
import { boundingBoxFor } from '../../../../lib/route-bbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  useCurrents?: boolean;
  via?: { lat: number; lon: number }[];
  options?: Record<string, unknown> & {
    autoMotor?: { minSail: number; motor: number };
    captureIsochrones?: boolean;
  };
}

function validate(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (!o.start || !o.end || typeof o.departure !== 'number') return false;
  if (typeof o.model !== 'string' || !['GFS', 'ECMWF'].includes(o.model)) return false;
  if (o.via !== undefined) {
    if (
      !Array.isArray(o.via) ||
      !o.via.every(
        (p) =>
          !!p &&
          typeof p === 'object' &&
          typeof (p as { lat?: unknown }).lat === 'number' &&
          typeof (p as { lon?: unknown }).lon === 'number',
      )
    ) {
      return false;
    }
  }
  return true;
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<unknown>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!validate(body)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'missing required fields' } },
      { status: 400 },
    );
  }
  const b = body;
  try {
    const bbox = boundingBoxFor([b.start, ...(b.via ?? []), b.end], 2);
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
    const planInput = {
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar,
      polarId: 'active',
      coastline,
      currents,
      options: {
        ...resolved,
        useCurrents: !!b.useCurrents,
        captureIsochrones: !!b.options?.captureIsochrones,
      },
    };
    const route = b.via && b.via.length > 0 ? planVia(planInput, b.via) : plan(planInput);
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
