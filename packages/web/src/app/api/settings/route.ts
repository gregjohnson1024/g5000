import { SETTINGS } from '../../../lib/paths';
import { readJson, writeJson } from '../../../lib/persistence';
import { parseJsonBody } from '../../../lib/req';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const settings = (await readJson(SETTINGS)) ?? {};
  return Response.json({ ok: true, settings });
}

export async function PUT(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<unknown>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'body must be a plain object' } },
      { status: 400 },
    );
  }
  await writeJson(SETTINGS, body);
  return Response.json({ ok: true });
}

/**
 * PATCH /api/settings — shallow top-level-key merge.
 *
 * Merges the request body onto the stored settings object at the top-level
 * key granularity.  Each client owns a distinct top-level key (planning,
 * anchorDashboard, emporiaConfig, forecastBbox, canadianTideCurrents) so a
 * per-key PATCH from one client never clobbers keys owned by another.
 *
 * Kills the read→merge→PUT clobber race that existed when multiple sections
 * on the same page did concurrent GETs then unconditional PUTs.
 */
export async function PATCH(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<unknown>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const patch = parsed.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'body must be a plain object' } },
      { status: 400 },
    );
  }
  const current = ((await readJson(SETTINGS)) as Record<string, unknown> | null) ?? {};
  const merged = { ...current, ...(patch as Record<string, unknown>) };
  await writeJson(SETTINGS, merged);
  return Response.json({ ok: true, settings: merged });
}
