import { NextResponse } from 'next/server';
import { getSharedRaceState } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';
import { sideOfLine } from '@g5000/compute/race';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PingBody {
  action: 'ping';
  end: 'port' | 'stbd';
  position: { lat: number; lon: number };
  /** Boat position at the moment of ping — used to compute preStartSide when
   *  both ends are pinged. If boatPos is too close to the line (e.g. the user
   *  is standing at an endpoint), preStartSide is deferred until the pipeline
   *  observes a non-degenerate GPS position. */
  boatPos?: { lat: number; lon: number };
}

interface ClearBody {
  action: 'clear';
}

type Body = PingBody | ClearBody;

/**
 * Cross-product magnitude in lon/lat space. Near zero when the boat is
 * essentially on the line (i.e. boatPos ≈ one of the endpoints).
 * Threshold of 1e-7 deg² corresponds to ~tens of metres from the line.
 */
function crossMagnitude(
  boat: { lat: number; lon: number },
  port: { lat: number; lon: number },
  stbd: { lat: number; lon: number },
): number {
  return Math.abs(
    (stbd.lon - port.lon) * (boat.lat - port.lat) - (stbd.lat - port.lat) * (boat.lon - port.lon),
  );
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
      // Set preStartSide only when both ends are present AND boatPos is
      // sufficiently off the line. If the boat is at (or very near) an
      // endpoint the cross product is near zero and the side is ambiguous —
      // defer to the pipeline, which will set it from the first non-degenerate
      // GPS sample after both ends are pinged.
      if (d.line.port && d.line.stbd && body.boatPos) {
        const mag = crossMagnitude(body.boatPos, d.line.port, d.line.stbd);
        if (mag > 1e-7) {
          d.line.preStartSide = sideOfLine(body.boatPos, d.line.port, d.line.stbd);
        }
        // else: preStartSide stays undefined; pipeline will fill it in lazily.
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
