import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type CrossoverSettings } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const settings = await firstValueFrom(store.crossoverSettings$);
  return NextResponse.json(settings);
}

export async function POST(req: Request): Promise<Response> {
  let body: Partial<CrossoverSettings>;
  try {
    body = (await req.json()) as Partial<CrossoverSettings>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const required = [
    'recommendationStableSeconds',
    'forecastIntervalMinutes',
    'forecastDurationHours',
  ] as const;
  const merged: CrossoverSettings = {
    recommendationStableSeconds: body.recommendationStableSeconds ?? 30,
    forecastIntervalMinutes: body.forecastIntervalMinutes ?? 30,
    forecastDurationHours: body.forecastDurationHours ?? 12,
  };
  for (const k of required) {
    if (typeof merged[k] !== 'number' || !Number.isFinite(merged[k])) {
      return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
    }
  }
  const store = getSharedConfigStore();
  await store.setCrossoverSettings(merged);
  return NextResponse.json({ ok: true });
}
