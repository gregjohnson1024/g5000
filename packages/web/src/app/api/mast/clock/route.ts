import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import type { ClockConfig, ClockMode } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_MODES: readonly ClockMode[] = ['utc', 'ship'];

/** Offsets are minutes east of UTC, half-hour steps, within [-12:00, +14:00]. */
function isValidOffsetMin(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === 'number' && Number.isInteger(v) && v % 30 === 0 && v >= -720 && v <= 840;
}

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const clock = store.getDisplayConfig().clock ?? { mode: 'utc', offsetMin: null };
  return NextResponse.json({ ok: true, clock });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { mode?: unknown; offsetMin?: unknown };
  if (typeof b.mode !== 'string' || !(VALID_MODES as readonly string[]).includes(b.mode)) {
    return NextResponse.json(
      { ok: false, error: `mode must be one of: ${VALID_MODES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!isValidOffsetMin(b.offsetMin ?? null)) {
    return NextResponse.json(
      { ok: false, error: 'offsetMin must be null or a 30-min-step integer in [-720, 840]' },
      { status: 400 },
    );
  }
  const clock: ClockConfig = {
    mode: b.mode as ClockMode,
    offsetMin: (b.offsetMin ?? null) as number | null,
  };
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), clock });
  return NextResponse.json({ ok: true, clock });
}
