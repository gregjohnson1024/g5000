import { NextResponse } from 'next/server';
import { getSharedMastRuntime, validateMastLayout, knownChannelSet } from '@g5000/mast';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const layout = getSharedMastRuntime().getLayout();
  return NextResponse.json({ ok: true, layout });
}

export async function PUT(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errors: ['invalid JSON'] }, { status: 400 });
  }

  const result = validateMastLayout(body, knownChannelSet());
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  await getSharedConfigStore().setMastLayout(result.layout);
  return NextResponse.json({ ok: true });
}
