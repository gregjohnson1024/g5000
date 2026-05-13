import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type SourcePriorityConfig } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → current source-priority config (`SourcePriorityRule[]`).
 *
 * Rules are an ordered array; the first rule whose `channelPattern` matches
 * a channel wins. Within a rule, `sources` is in priority order
 * (highest first). `freshnessSeconds` is the failover window.
 */
export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cfg = await firstValueFrom(store.sourcePriority$);
  return Response.json(cfg);
}

/**
 * PUT replaces the whole source-priority config.
 *
 * Body: `SourcePriorityRule[]` — see `@g5000/db` defaults.ts.
 *
 * Validation: must be an array. Each rule must have a non-empty
 * `channelPattern` (string), a non-empty `sources` array of strings, and a
 * positive finite `freshnessSeconds`. Invalid rules are dropped silently by
 * `setSourcePriority`; an entirely invalid body returns 422.
 */
export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'expected JSON array of SourcePriorityRule' }, { status: 422 });
  }
  // Lightweight type check — let setSourcePriority do the deep cleaning.
  for (const [i, rule] of body.entries()) {
    if (!rule || typeof rule !== 'object') {
      return Response.json({ error: `rule[${i}] is not an object` }, { status: 422 });
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.channelPattern !== 'string') {
      return Response.json(
        { error: `rule[${i}].channelPattern must be a string` },
        { status: 422 },
      );
    }
    if (!Array.isArray(r.sources)) {
      return Response.json(
        { error: `rule[${i}].sources must be an array of strings` },
        { status: 422 },
      );
    }
    if (typeof r.freshnessSeconds !== 'number' || !Number.isFinite(r.freshnessSeconds)) {
      return Response.json(
        { error: `rule[${i}].freshnessSeconds must be a finite number` },
        { status: 422 },
      );
    }
    if (r.blocked !== undefined && !Array.isArray(r.blocked)) {
      return Response.json(
        { error: `rule[${i}].blocked must be an array of strings if provided` },
        { status: 422 },
      );
    }
  }
  await store.setSourcePriority(body as SourcePriorityConfig);
  return Response.json({ ok: true });
}
