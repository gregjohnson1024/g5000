import { NextRequest, NextResponse } from 'next/server';
import { fetchCurrent } from '../../../../lib/weather-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get('lat') ?? String(DEFAULT_LAT));
  const lon = parseFloat(sp.get('lon') ?? String(DEFAULT_LON));

  try {
    const { data, stale } = await fetchCurrent(lat, lon);
    return NextResponse.json(stale ? { ...data, stale: true } : data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
