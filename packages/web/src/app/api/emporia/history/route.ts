import { getSharedEmporia, getSharedEmporiaHistory, type EmporiaScale } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_SCALES = new Set<EmporiaScale>(['1S', '1MIN', '15MIN', '1H', '1D', '1W', '1MON', '1Y']);

/** GET → historical Emporia usage data for a given device/channel/scale. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const gid = url.searchParams.get('gid');
  const channel = url.searchParams.get('channel');
  const scale = url.searchParams.get('scale') as EmporiaScale | null;
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  // Validate required parameters
  if (!gid || !channel || !start || !end) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Validate gid is numeric
  if (!/^\d+$/.test(gid)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Validate scale is in enum
  if (!scale || !VALID_SCALES.has(scale)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Check if history function is available
  const fn = getSharedEmporiaHistory();
  if (!fn) {
    return Response.json({ offline: true }, { status: 200 });
  }

  try {
    const data = await fn(Number(gid), channel, scale, start, end);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
