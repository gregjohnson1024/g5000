import { NextResponse } from 'next/server';
import { getSharedConfigStore, deleteShipLogEntry } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const activeBoatId = (): string => process.env.G5000_BOAT_ID ?? 'sula';

/**
 * DELETE /api/log/:id — remove a ship's-log entry. Scoped to the active boat
 * so a cross-boat id can't be deleted via parameter tampering.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const store = getSharedConfigStore();
  const ok = await deleteShipLogEntry(store, id, activeBoatId());
  if (!ok) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
