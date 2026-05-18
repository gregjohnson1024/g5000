import { NextResponse } from 'next/server';
import { getSharedAlarms } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_MANUAL_FIRE = new Set(['mob']);

/**
 * GET /api/alarms
 *
 * Returns the active alarm set plus the full known set (for history).
 * Active = unacked AND (not cleared OR sticky). See packages/core/src/alarms.ts.
 */
export async function GET(): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) {
    return NextResponse.json({ active: [], all: [] }, { status: 200 });
  }
  return NextResponse.json({
    active: registry.active(),
    all: registry.all(),
  });
}

/**
 * POST /api/alarms { id, action: 'fire', context? }
 *
 * Manual fire endpoint. Only the MOB alarm is manually fireable from the UI;
 * all other alarms (anchor-watch, shallow-water, over-speed, low-battery) are
 * fired by compute predicates against bus state.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) {
    return NextResponse.json({ ok: false, error: 'registry unavailable' }, { status: 503 });
  }

  let body: { id?: string; action?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (body.action !== 'fire') {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  if (!body.id || !ALLOWED_MANUAL_FIRE.has(body.id)) {
    return NextResponse.json({ ok: false, error: 'id not manually-fireable' }, { status: 400 });
  }
  if (body.id === 'mob') {
    registry.fire({
      id: 'mob',
      severity: 'CRITICAL',
      label: 'MOB',
      sticky: true,
      context: body.context,
    });
  }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/alarms { id, action: 'ack' }
 *
 * Acknowledges an active alarm. Removes from active list regardless of
 * sticky/clear state.
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) {
    return NextResponse.json({ ok: false, error: 'registry unavailable' }, { status: 503 });
  }

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }
  if (body.action === 'ack') {
    registry.ack(body.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
