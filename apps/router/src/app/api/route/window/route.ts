import { plan } from '@g5000/routing';
import type { PolarTable } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { loadWindFor, loadCurrentFor } from '../../../../lib/grib-context';
import { loadDefaultCoastline } from '../../../../lib/coastline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  windowStart: number; // unix seconds
  windowHours: number;
  stepHours: number;
  model: 'GFS' | 'ECMWF';
  polar: PolarTable;
  polarId: string;
  useCurrents?: boolean;
}

interface WindowResult {
  departure: number;
  eta: number;
  distance: number;
  meanTws: number;
  maxTws: number;
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
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
  if (!o.start || !o.end) return false;
  if (
    typeof o.windowStart !== 'number' ||
    typeof o.windowHours !== 'number' ||
    typeof o.stepHours !== 'number'
  ) {
    return false;
  }
  if (o.windowHours <= 0 || o.stepHours <= 0) return false;
  if (typeof o.model !== 'string' || !['GFS', 'ECMWF'].includes(o.model)) return false;
  if (!o.polar || !o.polarId) return false;
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
      { ok: false, error: { kind: 'bad_request', message: 'missing or invalid fields' } },
      { status: 400 },
    );
  }
  const b = body;
  try {
    const bbox = bboxAround(b.start, b.end);
    // We need enough wind data to cover (window span) + a max route (168h).
    const horizon = b.windowHours + 168;
    const wind = await loadWindFor(b.model, bbox, horizon);
    let currents: CurrentField | undefined;
    if (b.useCurrents) {
      currents = await loadCurrentFor(bbox, horizon);
    }
    const coastline = await loadDefaultCoastline();
    const results: WindowResult[] = [];
    const stepSec = b.stepHours * 3600;
    const endTime = b.windowStart + b.windowHours * 3600;
    for (let t = b.windowStart; t < endTime; t += stepSec) {
      const r = plan({
        start: b.start,
        end: b.end,
        departure: t,
        wind,
        polar: b.polar,
        polarId: b.polarId,
        coastline,
        currents,
        options: { useCurrents: !!b.useCurrents, maxHours: 168 },
      });
      let meanTws = 0;
      let maxTws = 0;
      for (const l of r.legs) {
        meanTws += l.tws;
        if (l.tws > maxTws) maxTws = l.tws;
      }
      meanTws /= Math.max(1, r.legs.length);
      results.push({
        departure: t,
        eta: r.end,
        distance: r.distance,
        meanTws,
        maxTws,
        ...(r.incomplete ? { incomplete: true, reason: r.reason } : {}),
      });
    }
    return Response.json({ ok: true, results });
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
