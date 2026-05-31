import { NextResponse } from 'next/server';
import { knownChannelSet } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const channels = [...knownChannelSet()].sort();
  return NextResponse.json({ ok: true, channels });
}
