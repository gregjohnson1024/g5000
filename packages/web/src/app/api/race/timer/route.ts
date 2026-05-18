import { NextResponse } from 'next/server';
import { getSharedRaceState } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: { action?: string; offsetSec?: number; adjustSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  switch (body.action) {
    case 'start': {
      const offsetSec = body.offsetSec ?? 300;
      rs.mutate((d) => {
        d.timer.startMs = Date.now() + offsetSec * 1000;
        d.timer.state = 'pre-start';
      });
      break;
    }
    case 'sync': {
      const adjustSec = body.adjustSec ?? 0;
      rs.mutate((d) => {
        if (d.timer.startMs !== null) {
          d.timer.startMs += adjustSec * 1000;
        }
      });
      break;
    }
    case 'reset': {
      rs.mutate((d) => {
        d.timer.startMs = null;
        d.timer.state = 'idle';
      });
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  try {
    await saveRaceState(getSharedConfigStore(), rs.get());
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
