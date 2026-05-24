import { join } from 'node:path';
import { ROOT } from '../../../../lib/paths';
import { pruneCache } from '../../../../lib/sat-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { maxGb?: number; olderThanDays?: number } = {};
  try {
    body = (await req.json()) as { maxGb?: number; olderThanDays?: number };
  } catch {
    /* empty / invalid body → handled by the guard below */
  }
  const opts: { maxBytes?: number; olderThanDays?: number } = {};
  if (typeof body.maxGb === 'number' && body.maxGb > 0) {
    opts.maxBytes = body.maxGb * 1024 ** 3;
  }
  if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
    opts.olderThanDays = body.olderThanDays;
  }
  if (opts.maxBytes === undefined && opts.olderThanDays === undefined) {
    return new Response('provide maxGb or olderThanDays', { status: 400 });
  }
  const result = await pruneCache(join(ROOT, 'sat-cache'), opts);
  return Response.json(result);
}
