import { describe, it, expect } from 'vitest';
import { parseGpx } from './gpx-import';

const GPX_OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test">';

describe('parseGpx — waypoints only', () => {
  it('parses multiple <wpt> with name/desc', () => {
    const parsed = parseGpx(
      `${GPX_OPEN}
        <wpt lat="41.4869" lon="-71.3258"><name>Newport</name><desc>Shipyard</desc></wpt>
        <wpt lat="41.1817" lon="-71.5667"><name>Block Island</name></wpt>
      </gpx>`,
    );
    expect(parsed.routes).toHaveLength(0);
    expect(parsed.waypoints).toEqual([
      { name: 'Newport', lat: 41.4869, lon: -71.3258, desc: 'Shipyard' },
      { name: 'Block Island', lat: 41.1817, lon: -71.5667 },
    ]);
  });

  it('handles a single <wpt> (non-array coercion) and defaults a missing name', () => {
    const parsed = parseGpx(`${GPX_OPEN}<wpt lat="1.5" lon="-2.5"/></gpx>`);
    expect(parsed.waypoints).toEqual([{ name: 'Waypoint 1', lat: 1.5, lon: -2.5 }]);
  });

  it('decodes XML entities in names', () => {
    const parsed = parseGpx(
      `${GPX_OPEN}<wpt lat="0" lon="0"><name>A &amp; B &lt;C&gt;</name></wpt></gpx>`,
    );
    expect(parsed.waypoints[0]?.name).toBe('A & B <C>');
  });
});

describe('parseGpx — routes', () => {
  it('parses <rte> with ordered <rtept>s', () => {
    const parsed = parseGpx(
      `${GPX_OPEN}
        <rte><name>Passage</name>
          <rtept lat="41.18" lon="-71.57"><name>Start</name></rtept>
          <rtept lat="41.49" lon="-71.33"/>
        </rte>
      </gpx>`,
    );
    expect(parsed.waypoints).toHaveLength(0);
    expect(parsed.routes).toEqual([
      {
        name: 'Passage',
        points: [
          { name: 'Start', lat: 41.18, lon: -71.57 },
          { lat: 41.49, lon: -71.33 },
        ],
      },
    ]);
  });

  it('defaults an unnamed route name', () => {
    const parsed = parseGpx(`${GPX_OPEN}<rte><rtept lat="1" lon="2"/></rte></gpx>`);
    expect(parsed.routes[0]?.name).toBe('Route 1');
  });
});

describe('parseGpx — tracks', () => {
  it('flattens <trk>/<trkseg>/<trkpt> across segments into one route', () => {
    const parsed = parseGpx(
      `${GPX_OPEN}
        <trk><name>Recorded</name>
          <trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg>
          <trkseg><trkpt lat="5" lon="6"/></trkseg>
        </trk>
      </gpx>`,
    );
    expect(parsed.routes).toEqual([
      {
        name: 'Recorded',
        points: [
          { lat: 1, lon: 2 },
          { lat: 3, lon: 4 },
          { lat: 5, lon: 6 },
        ],
      },
    ]);
  });
});

describe('parseGpx — mixed documents', () => {
  it('returns wpts plus rte and trk (tracks after routes)', () => {
    const parsed = parseGpx(
      `${GPX_OPEN}
        <wpt lat="10" lon="20"><name>W</name></wpt>
        <rte><name>R</name><rtept lat="1" lon="2"/></rte>
        <trk><name>T</name><trkseg><trkpt lat="3" lon="4"/></trkseg></trk>
      </gpx>`,
    );
    expect(parsed.waypoints.map((w) => w.name)).toEqual(['W']);
    expect(parsed.routes.map((r) => r.name)).toEqual(['R', 'T']);
  });
});

describe('parseGpx — malformed input', () => {
  it('rejects non-well-formed XML', () => {
    expect(() => parseGpx('<gpx><wpt lat="1" lon="2">')).toThrow(/not well-formed XML/);
  });

  it('rejects a document without a <gpx> root', () => {
    expect(() => parseGpx('<?xml version="1.0"?><kml></kml>')).toThrow(/missing <gpx> root/);
  });

  it('rejects a waypoint missing lat', () => {
    expect(() => parseGpx(`${GPX_OPEN}<wpt lon="2"/></gpx>`)).toThrow(/invalid lat/);
  });

  it('rejects non-numeric and out-of-range coordinates', () => {
    expect(() => parseGpx(`${GPX_OPEN}<wpt lat="north" lon="2"/></gpx>`)).toThrow(/lat/);
    expect(() => parseGpx(`${GPX_OPEN}<wpt lat="91" lon="2"/></gpx>`)).toThrow(/lat/);
    expect(() => parseGpx(`${GPX_OPEN}<wpt lat="1" lon="181"/></gpx>`)).toThrow(/lon/);
  });

  it('names the offending point in route/track errors', () => {
    expect(() => parseGpx(`${GPX_OPEN}<rte><rtept lat="1"/></rte></gpx>`)).toThrow(
      /<rtept> 1 of route 1/,
    );
  });
});
