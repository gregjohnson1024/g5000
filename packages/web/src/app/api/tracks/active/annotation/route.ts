import { activeTrack, appendAnnotation, type TrackAnnotation } from '../../../../../lib/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS = new Set<TrackAnnotation['kind']>(['event', 'periodStart', 'periodEnd']);

/**
 * GET /api/tracks/active/annotation
 *
 * Lightweight read — returns just the annotations and the track id
 * (no points). Used by <AnnotationDropper> to discover open-period
 * state without dragging the full points payload.
 */
export async function GET(): Promise<Response> {
  const t = await activeTrack();
  if (!t) return Response.json({ trackId: null, annotations: [] });
  return Response.json({ trackId: t.id, annotations: t.annotations ?? [] });
}

/**
 * POST /api/tracks/active/annotation
 *
 * Body: { label: string, kind: 'event' | 'periodStart' | 'periodEnd' }
 *
 * Server stamps tsMs = Date.now() and appends. 404 when there is no
 * active track. 400 on validation failure.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'expected an object' }, { status: 400 });
  }
  const { label, kind } = body as { label?: unknown; kind?: unknown };
  if (typeof label !== 'string' || label.length === 0) {
    return Response.json({ error: 'label is required' }, { status: 400 });
  }
  if (typeof kind !== 'string' || !KINDS.has(kind as TrackAnnotation['kind'])) {
    return Response.json(
      { error: `kind must be one of: ${[...KINDS].join(', ')}` },
      { status: 400 },
    );
  }
  const t = await activeTrack();
  if (!t) return Response.json({ error: 'no active track' }, { status: 404 });
  const ann: TrackAnnotation = {
    tsMs: Date.now(),
    label,
    kind: kind as TrackAnnotation['kind'],
  };
  const updated = await appendAnnotation(t.id, ann);
  if (!updated) {
    return Response.json({ error: 'active track disappeared' }, { status: 404 });
  }
  return Response.json({
    trackId: updated.id,
    annotations: updated.annotations ?? [],
  });
}
