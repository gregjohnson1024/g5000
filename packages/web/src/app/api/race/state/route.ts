import { NextResponse } from 'next/server';
import { getSharedRaceState, type RaceSettings } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  return NextResponse.json(rs.get());
}

export async function PUT(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: { settings?: Partial<RaceSettings>; activeMarkWaypointId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  rs.mutate((draft) => {
    if (body.settings) {
      draft.settings = { ...draft.settings, ...body.settings };
    }
    if (body.activeMarkWaypointId === null) {
      draft.activeMarkWaypointId = undefined;
    } else if (typeof body.activeMarkWaypointId === 'string') {
      draft.activeMarkWaypointId = body.activeMarkWaypointId;
    }
  });
  try {
    const store = getSharedConfigStore();
    await saveRaceState(store, rs.get());
  } catch {
    /* persistence is best-effort here; live state is canonical */
  }
  return NextResponse.json({ ok: true });
}
