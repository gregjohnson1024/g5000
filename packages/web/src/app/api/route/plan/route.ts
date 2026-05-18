import { plan } from '@g5000/routing';
import type { PolarTable, SailWardrobe } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { loadWindFor, loadCurrentFor } from '../../../../lib/grib-context';
import { loadDefaultCoastline } from '../../../../lib/coastline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  /** Single-polar mode. Mutually exclusive with `wardrobe`. */
  polar?: PolarTable;
  polarId: string;
  useCurrents?: boolean;
  options?: Record<string, unknown>;
  /** Wardrobe mode: server runs the wardrobe-aware planner. */
  wardrobe?: SailWardrobe;
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
  if (!o.polarId) return false;
  const hasPolar = !!o.polar;
  const hasWardrobe = !!o.wardrobe;
  if (!hasPolar && !hasWardrobe) return false;
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
    const route = plan({
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar: b.polar,
      polarId: b.polarId,
      coastline,
      currents,
      wardrobe: b.wardrobe,
      options: { ...(b.options ?? {}), useCurrents: !!b.useCurrents, captureIsochrones: true },
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
