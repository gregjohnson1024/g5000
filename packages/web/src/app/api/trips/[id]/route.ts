import { NextResponse } from 'next/server';
import {
  getSharedConfigStore,
  getTrip,
  updateTrip,
  deleteTrip,
  type TripMode,
  type UpdateTripPatch,
} from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const activeBoatId = (): string => process.env.G5000_BOAT_ID ?? 'sula';

const VALID_MODES: ReadonlySet<TripMode> = new Set(['sail', 'motor', 'mixed', 'unknown']);

const parseId = (idStr: string): number | null => {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const badRequest = (message: string): NextResponse =>
  NextResponse.json({ ok: false, error: { message } }, { status: 400 });

interface PatchBody {
  mode?: unknown;
  moorageStartName?: unknown;
  moorageEndName?: unknown;
  notes?: unknown;
}

/**
 * PATCH /api/trips/:id — edit the user-owned fields (mode, moorage names,
 * notes). Measurements are immutable. Scoped to the active boat.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return badRequest('invalid id');

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return badRequest('invalid json');
  }
  if (body === null || typeof body !== 'object') return badRequest('body must be an object');

  const patch: UpdateTripPatch = {};
  if (body.mode !== undefined) {
    if (typeof body.mode !== 'string' || !VALID_MODES.has(body.mode as TripMode)) {
      return badRequest('mode must be sail, motor, mixed or unknown');
    }
    patch.mode = body.mode as TripMode;
  }
  for (const key of ['moorageStartName', 'moorageEndName', 'notes'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return badRequest(`${key} must be a string or null`);
    patch[key] = v;
  }

  const store = getSharedConfigStore();
  const ok = await updateTrip(store, id, activeBoatId(), patch);
  if (!ok) {
    return NextResponse.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  }
  const trip = await getTrip(store, id, activeBoatId());
  return NextResponse.json({ ok: true, trip });
}

/**
 * DELETE /api/trips/:id — remove a trip. Scoped to the active boat so a
 * cross-boat id can't be deleted via parameter tampering.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return badRequest('invalid id');

  const store = getSharedConfigStore();
  const ok = await deleteTrip(store, id, activeBoatId());
  if (!ok) {
    return NextResponse.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
