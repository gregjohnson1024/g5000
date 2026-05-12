import type { Route } from '@g5000/routing';

export function routeToGpx(r: Route, name: string): string {
  const trkpts = r.legs
    .map(
      (l) =>
        `      <trkpt lat="${l.lat}" lon="${l.lon}">\n` +
        `        <time>${new Date(l.t * 1000).toISOString()}</time>\n` +
        `      </trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="g5000-router" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}
