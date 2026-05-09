import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type AwsAwaCalTable } from '@h6000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.awsAwaCal$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: AwsAwaCalTable;
  try {
    body = (await req.json()) as AwsAwaCalTable;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validateAwsAwaCal(body)) {
    return Response.json(
      { error: 'invalid cal table shape' },
      { status: 422 },
    );
  }
  await store.setAwsAwaCal(body);
  return Response.json({ ok: true });
}

function validateAwsAwaCal(cal: unknown): cal is AwsAwaCalTable {
  if (!cal || typeof cal !== 'object') return false;
  const c = cal as Record<string, unknown>;
  if (
    !Array.isArray(c.awsBins) ||
    !Array.isArray(c.awaBins) ||
    !Array.isArray(c.angleCorrection) ||
    !Array.isArray(c.speedMultiplier)
  ) {
    return false;
  }
  const aws = c.awsBins.length;
  const awa = c.awaBins.length;
  if (
    (c.angleCorrection as unknown[]).length !== aws ||
    (c.speedMultiplier as unknown[]).length !== aws
  ) {
    return false;
  }
  for (const row of c.angleCorrection as unknown[]) {
    if (!Array.isArray(row) || row.length !== awa) return false;
  }
  for (const row of c.speedMultiplier as unknown[]) {
    if (!Array.isArray(row) || row.length !== awa) return false;
  }
  return true;
}
