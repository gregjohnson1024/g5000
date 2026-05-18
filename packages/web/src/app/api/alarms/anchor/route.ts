import { NextResponse } from 'next/server';
import type { AlarmsConfig } from '@g5000/db';

interface ConfigRef {
  current: AlarmsConfig;
}

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json({ ok: false, error: 'config ref unbound' }, { status: 503 });

  let body: { action?: string; position?: { lat: number; lon: number }; radiusM?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (body.action === 'drop') {
    const position = body.position;
    if (!position)
      return NextResponse.json({ ok: false, error: 'position required for drop' }, { status: 400 });
    const radiusM = body.radiusM ?? ref.current.thresholds.anchor.radiusM ?? 50;
    ref.current = {
      ...ref.current,
      thresholds: {
        ...ref.current.thresholds,
        anchor: {
          armed: true,
          point: position,
          droppedAt: new Date().toISOString(),
          radiusM,
        },
      },
    };
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'weigh') {
    ref.current = {
      ...ref.current,
      thresholds: {
        ...ref.current.thresholds,
        anchor: { ...ref.current.thresholds.anchor, armed: false },
      },
    };
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
