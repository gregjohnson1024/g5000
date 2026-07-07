import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Allowed preset scale values. */
const VALID_SCALES = [1.0, 1.15, 1.6] as const;
type ValidScale = (typeof VALID_SCALES)[number];

function clampToNearest(v: number): ValidScale {
  return VALID_SCALES.reduce((prev, curr) =>
    Math.abs(curr - v) < Math.abs(prev - v) ? curr : prev,
  );
}

export async function GET(): Promise<NextResponse> {
  const scale = getSharedConfigStore().getDisplayConfig().scale ?? 1.0;
  return NextResponse.json({ ok: true, scale });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { scale?: unknown };
  if (typeof b.scale !== 'number' || !isFinite(b.scale)) {
    return NextResponse.json(
      { ok: false, error: 'scale must be a finite number (valid presets: 1.0, 1.15, 1.6)' },
      { status: 400 },
    );
  }
  // Accept exact preset values or clamp to nearest preset.
  const scale = clampToNearest(b.scale);
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), scale });
  return NextResponse.json({ ok: true, scale });
}
