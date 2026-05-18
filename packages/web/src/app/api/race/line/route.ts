import { NextResponse } from 'next/server';
import { getSharedRaceState } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PingBody {
  action: 'ping';
  end: 'port' | 'stbd';
  position: { lat: number; lon: number };
  /** Boat position at the moment of ping — only meaningful on the second
   *  ping, used to compute preStartSide. Optional. */
  boatPos?: { lat: number; lon: number };
}

interface ClearBody {
  action: 'clear';
}

type Body = PingBody | ClearBody;

function sideOfLine(
  boat: { lat: number; lon: number },
  port: { lat: number; lon: number },
  stbd: { lat: number; lon: number },
): 'port' | 'stbd' {
  // Cross product of (stbd - port) and (boat - port). Positive = left of
  // the port→stbd direction (which is the boat's port side if you stand
  // at port looking at stbd). Return 'port' when boat is to port-side, etc.
  const cross =
    (stbd.lon - port.lon) * (boat.lat - port.lat) -
    (stbd.lat - port.lat) * (boat.lon - port.lon);
  return cross > 0 ? 'port' : 'stbd';
}

export async function POST(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (body.action === 'clear') {
    rs.mutate((d) => {
      d.line.port = undefined;
      d.line.stbd = undefined;
      d.line.preStartSide = undefined;
    });
  } else if (body.action === 'ping') {
    if (
      !body.position ||
      typeof body.position.lat !== 'number' ||
      typeof body.position.lon !== 'number'
    ) {
      return NextResponse.json({ ok: false, error: 'position required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    rs.mutate((d) => {
      const end = body.end;
      d.line[end] = { lat: body.position.lat, lon: body.position.lon, pingedAt: now };
      // If both ends now present and boatPos provided, set preStartSide.
      if (d.line.port && d.line.stbd && body.boatPos) {
        d.line.preStartSide = sideOfLine(body.boatPos, d.line.port, d.line.stbd);
      }
    });
  } else {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  try {
    await saveRaceState(getSharedConfigStore(), rs.get());
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
