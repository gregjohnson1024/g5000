import { NextResponse } from 'next/server';
import { getSharedConfigStore, listAlarmHistory } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  try {
    const store = getSharedConfigStore();
    const rows = listAlarmHistory(store, { limit });
    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}
