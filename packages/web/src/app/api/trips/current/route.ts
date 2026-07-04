import { NextResponse } from 'next/server';
import { getSourceModeController } from '@g5000/core';
import type { TripDetectorSnapshot } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/trips/current — live snapshot of the trip engine (moored/underway,
 * since-when, live distance/duration), plus the current source mode for
 * context (the engine only consumes fixes while live).
 */
export async function GET(): Promise<NextResponse> {
  const engine = (
    globalThis as { __g5000_trip_engine__?: { snapshot: () => TripDetectorSnapshot } }
  ).__g5000_trip_engine__;
  if (!engine) {
    return NextResponse.json(
      { ok: false, error: { message: 'trip engine not running' } },
      { status: 503 },
    );
  }
  const snapshot = engine.snapshot();
  const mode = getSourceModeController()?.getStatus().mode ?? null;
  return NextResponse.json({ ok: true, snapshot, mode });
}
