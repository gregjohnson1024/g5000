import { join } from 'node:path';
import { ROOT } from '../../../lib/paths';
import { readCacheStats } from '../../../lib/sat-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const stats = await readCacheStats(join(ROOT, 'sat-cache'));
  return Response.json(stats);
}
