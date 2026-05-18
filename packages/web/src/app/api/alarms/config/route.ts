import { NextResponse } from 'next/server';
import {
  DEFAULT_ALARMS_CONFIG,
  getSharedConfigStore,
  saveAlarmsConfig,
  type AlarmsConfig,
} from '@g5000/db';

interface ConfigRef {
  current: AlarmsConfig;
}

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json(DEFAULT_ALARMS_CONFIG);
  return NextResponse.json(ref.current);
}

export async function PUT(req: Request): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json({ ok: false, error: 'config ref unbound' }, { status: 503 });

  let body: AlarmsConfig;
  try {
    body = (await req.json()) as AlarmsConfig;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Replace the ref so predicates see the new config on their next sample.
  ref.current = body;

  // Best-effort persist via the shared ConfigStore.
  try {
    const store = getSharedConfigStore();
    await saveAlarmsConfig(store, body);
  } catch {
    // Persistence failures don't break the route — the in-memory ref still takes effect.
  }

  return NextResponse.json({ ok: true });
}
