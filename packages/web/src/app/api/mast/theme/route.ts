import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import type { Theme } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_THEMES: readonly Theme[] = ['day', 'night', 'sun'];

export async function GET(): Promise<NextResponse> {
  const { theme } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, theme });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { theme?: unknown };
  if (typeof b.theme !== 'string' || !(VALID_THEMES as readonly string[]).includes(b.theme)) {
    return NextResponse.json(
      { ok: false, error: `theme must be one of: ${VALID_THEMES.join(', ')}` },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), theme: b.theme as Theme });
  return NextResponse.json({ ok: true, theme: b.theme });
}
