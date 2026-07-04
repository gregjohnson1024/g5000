import { getTrack } from '../../../../../lib/tracks';
import { trackToGpx } from '../../../../../lib/gpx-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/tracks/[id]/export-gpx — one recorded track as a GPX 1.1 <trk> file. */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const track = await getTrack(id);
  if (!track) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  const gpx = trackToGpx(track.points, track.label || track.id);
  return new Response(gpx, {
    headers: {
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${track.id}.gpx"`,
    },
  });
}
