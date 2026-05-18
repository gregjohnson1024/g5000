import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import {
  getSharedConfigStore,
  type CrossoverSettings,
  DEFAULT_CROSSOVER_SETTINGS,
} from '@g5000/db';

const NUMERIC_KEYS = [
  'recommendationStableSeconds',
  'chartTwsMaxKn',
  'chartTwaMinDeg',
  'chartTwaMaxDeg',
  'forecastIntervalMinutes',
  'forecastDurationHours',
] as const satisfies ReadonlyArray<keyof CrossoverSettings>;

export async function GET() {
  const store = getSharedConfigStore();
  const settings = await firstValueFrom(store.crossoverSettings$);
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const merged: CrossoverSettings = { ...DEFAULT_CROSSOVER_SETTINGS };
  for (const k of NUMERIC_KEYS) {
    const v = body[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      merged[k] = v as never;
    }
  }
  const store = getSharedConfigStore();
  await store.setCrossoverSettings(merged);
  return NextResponse.json({ ok: true, settings: merged });
}
