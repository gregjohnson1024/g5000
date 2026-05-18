import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type CrossoverMap } from '@g5000/db';

export async function GET() {
  const store = getSharedConfigStore();
  const map = await firstValueFrom(store.crossoverMap$);
  const wardrobe = await firstValueFrom(store.sails$);
  const valid = new Set(wardrobe.configs.map((c) => c.id));
  // Filter dangling configIds (configs that have since been deleted from the
  // wardrobe). Read-side filter keeps the stored map intact in case the
  // config is restored.
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(map.cells)) {
    if (valid.has(v)) filtered[k] = v;
  }
  return NextResponse.json({ ok: true, map: { ...map, cells: filtered } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: 'invalid JSON body' } },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { boatId?: unknown }).boatId !== 'string' ||
    typeof (body as { mode?: unknown }).mode !== 'string' ||
    typeof (body as { cells?: unknown }).cells !== 'object' ||
    (body as { cells: unknown }).cells === null
  ) {
    return NextResponse.json(
      { ok: false, error: { message: 'expected { boatId, mode, cells }' } },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  const wardrobe = await firstValueFrom(store.sails$);
  const valid = new Set(wardrobe.configs.map((c) => c.id));
  const cells = (body as { cells: Record<string, unknown> }).cells;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (typeof v === 'string' && valid.has(v)) cleaned[k] = v;
  }
  const map: CrossoverMap = {
    boatId: (body as { boatId: string }).boatId,
    mode: (body as { mode: string }).mode,
    cells: cleaned,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  try {
    await store.setCrossoverMap(map);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, map });
}
