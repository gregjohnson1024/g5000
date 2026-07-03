import { NextResponse } from 'next/server';
import type { AlarmsConfig, AnchorThreshold } from '@g5000/db';
import { getSharedAlarms } from '@g5000/core';
import { projectPoint } from '@g5000/compute';

interface ConfigRef {
  current: AlarmsConfig;
}

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/alarms/anchor
 *
 * Returns the current AnchorThreshold plus live breach state derived from the
 * alarms registry (cheap — no bus subscription): `breached` is true while the
 * anchor-watch condition currently holds, `alarm` is the active snapshot (may
 * be a sticky CRITICAL whose condition has since cleared).
 */
export async function GET(): Promise<NextResponse> {
  const ref = getRef();
  if (!ref)
    return NextResponse.json(
      { ok: false, error: { message: 'config ref unbound' } },
      { status: 503 },
    );
  const registry = getSharedAlarms();
  const snapshot = registry?.get('anchor-watch');
  const alarm =
    snapshot && snapshot.ackedAt === null && (snapshot.clearedAt === null || snapshot.sticky)
      ? snapshot
      : null;
  const breached =
    snapshot !== undefined && snapshot.ackedAt === null && snapshot.clearedAt === null;
  return NextResponse.json({ ok: true, anchor: ref.current.thresholds.anchor, breached, alarm });
}

interface DropBody {
  action?: string;
  position?: { lat: number; lon: number };
  radiusM?: number;
  offsetM?: number;
  offsetBearingDeg?: number;
  coneDeg?: number;
  coneCenterDeg?: number;
  escalateAfterS?: number;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ref = getRef();
  if (!ref)
    return NextResponse.json(
      { ok: false, error: { message: 'config ref unbound' } },
      { status: 503 },
    );

  let body: DropBody;
  try {
    body = (await req.json()) as DropBody;
  } catch {
    return NextResponse.json({ ok: false, error: { message: 'invalid json' } }, { status: 400 });
  }

  if (body.action === 'drop') {
    const position = body.position;
    if (!position)
      return NextResponse.json(
        { ok: false, error: { message: 'position required for drop' } },
        { status: 400 },
      );
    const radiusM = body.radiusM ?? ref.current.thresholds.anchor.radiusM ?? 50;
    // The drop is issued from the boat (bow roller); when the anchor actually
    // lies offsetM along offsetBearingDeg from there, resolve its position.
    const hasOffset = body.offsetM !== undefined && body.offsetBearingDeg !== undefined;
    const anchorPoint = hasOffset
      ? projectPoint(position.lat, position.lon, body.offsetBearingDeg!, body.offsetM!)
      : position;
    const anchor: AnchorThreshold = {
      armed: true,
      point: position,
      anchorPoint,
      droppedAt: new Date().toISOString(),
      radiusM,
      ...(hasOffset ? { offsetM: body.offsetM, offsetBearingDeg: body.offsetBearingDeg } : {}),
      ...(body.coneDeg !== undefined ? { coneDeg: body.coneDeg } : {}),
      ...(body.coneCenterDeg !== undefined ? { coneCenterDeg: body.coneCenterDeg } : {}),
      ...(body.escalateAfterS !== undefined ? { escalateAfterS: body.escalateAfterS } : {}),
    };
    ref.current = {
      ...ref.current,
      thresholds: { ...ref.current.thresholds, anchor },
    };
    return NextResponse.json({ ok: true, anchor });
  }

  if (body.action === 'weigh') {
    ref.current = {
      ...ref.current,
      thresholds: {
        ...ref.current.thresholds,
        anchor: { ...ref.current.thresholds.anchor, armed: false },
      },
    };
    // Retire any in-flight anchor alarm: clear the condition, then ack so a
    // sticky (escalated) CRITICAL doesn't linger in the active set.
    const registry = getSharedAlarms();
    registry?.clear('anchor-watch');
    registry?.ack('anchor-watch');
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: { message: 'unknown action' } }, { status: 400 });
}
