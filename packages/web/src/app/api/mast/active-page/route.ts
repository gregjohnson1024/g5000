import { NextResponse } from 'next/server';
import { getSharedMastRuntime } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { pageId: string | null };
  try {
    body = (await req.json()) as { pageId: string | null };
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const mastRuntime = getSharedMastRuntime();

  if (body.pageId === null) {
    mastRuntime.setOverride(null);
    return NextResponse.json({ ok: true, override: null });
  }
  if (typeof body.pageId !== 'string') {
    return NextResponse.json({ error: 'pageId must be a string or null' }, { status: 400 });
  }
  const exists = mastRuntime.getLayout().pages.some((p) => p.id === body.pageId);
  if (!exists) {
    return NextResponse.json({ error: `unknown page "${body.pageId}"` }, { status: 400 });
  }
  mastRuntime.setOverride(body.pageId);
  return NextResponse.json({ ok: true, override: body.pageId });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, override: getSharedMastRuntime().getOverride() });
}
