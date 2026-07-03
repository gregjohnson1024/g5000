import { describe, it, expect } from 'vitest';
import { waypointsToGpx, savedRouteToGpx } from './gpx-export';
import type { Route, Waypoint } from '@g5000/db';

const wp = (over: Partial<Waypoint> & Pick<Waypoint, 'id' | 'name' | 'lat' | 'lon'>): Waypoint => ({
  createdAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const NEWPORT = wp({ id: 'newport', name: 'Newport', lat: 41.4869, lon: -71.3258 });
const BLOCK = wp({
  id: 'block-island',
  name: 'Block Island',
  lat: 41.1817,
  lon: -71.5667,
  notes: "Champlin's Marina",
});

describe('waypointsToGpx', () => {
  it('produces GPX 1.1 with one <wpt> per waypoint', () => {
    const gpx = waypointsToGpx([NEWPORT, BLOCK]);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<wpt lat="41.4869" lon="-71.3258">');
    expect(gpx).toContain('<name>Newport</name>');
    expect(gpx).toContain('<wpt lat="41.1817" lon="-71.5667">');
    expect(gpx.match(/<wpt /g)).toHaveLength(2);
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  it('emits notes as <desc> and omits it when absent', () => {
    const gpx = waypointsToGpx([NEWPORT, BLOCK]);
    expect(gpx).toContain('<desc>Champlin&apos;s Marina</desc>');
    expect(gpx.match(/<desc>/g)).toHaveLength(1);
  });

  it('escapes XML special characters in name and notes', () => {
    const gpx = waypointsToGpx([
      wp({ id: 'x', name: 'A <"&\'> B', lat: 1, lon: 2, notes: 'a & b < c' }),
    ]);
    expect(gpx).toContain('<name>A &lt;&quot;&amp;&apos;&gt; B</name>');
    expect(gpx).toContain('<desc>a &amp; b &lt; c</desc>');
    expect(gpx).not.toContain('<"');
  });

  it('handles an empty waypoint list', () => {
    const gpx = waypointsToGpx([]);
    expect(gpx).not.toContain('<wpt');
    expect(gpx).toContain('</gpx>');
  });
});

describe('savedRouteToGpx', () => {
  const route: Route = {
    id: 'passage',
    name: 'Bermuda <Leg 2>',
    waypointIds: ['block-island', 'newport'],
    notes: 'fuel & rest',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  it('joins waypointIds against the waypoint list, in route order', () => {
    const gpx = savedRouteToGpx(route, [NEWPORT, BLOCK]);
    expect(gpx).toContain('<rte>');
    const iBlock = gpx.indexOf('lat="41.1817"');
    const iNewport = gpx.indexOf('lat="41.4869"');
    expect(iBlock).toBeGreaterThan(-1);
    expect(iNewport).toBeGreaterThan(iBlock);
    expect(gpx.match(/<rtept /g)).toHaveLength(2);
  });

  it('escapes the route name and notes', () => {
    const gpx = savedRouteToGpx(route, [NEWPORT, BLOCK]);
    expect(gpx).toContain('<name>Bermuda &lt;Leg 2&gt;</name>');
    expect(gpx).toContain('<desc>fuel &amp; rest</desc>');
  });

  it('throws on a waypointId with no matching waypoint', () => {
    expect(() => savedRouteToGpx(route, [NEWPORT])).toThrow(/unknown waypoint id "block-island"/);
  });
});
