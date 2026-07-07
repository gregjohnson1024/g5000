'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from './HelmTile';
import { scalar, fmtSpeed, fmtHeading, fmtHeadingRad } from './tile-helpers';

/** The six pinned tiles shown on every helm group. */
export function CoreStrip({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const sog = channels.get('nav.gps.sog');
  const depth = channels.get('nav.depth');
  const tws = channels.get('wind.true.speed');
  const twd = channels.get('wind.true.direction');

  const cogTrue = channels.get('nav.gps.cog');
  const cogMag = channels.get('nav.gps.cog.magnetic');
  const cog = cogTrue ?? cogMag;
  const cogRef = cogTrue ? 'T' : cogMag ? 'M' : null;

  const hdgTrueRad = scalar(channels.get('boat.heading.true'));
  const hdgMagRad = scalar(channels.get('boat.heading.magnetic'));
  const magVarRad = scalar(channels.get('nav.magvar'));
  let hdgValueRad: number | null = null;
  let hdgRef: 'T' | 'M' | null = null;
  if (hdgTrueRad !== null) {
    hdgValueRad = hdgTrueRad;
    hdgRef = 'T';
  } else if (hdgMagRad !== null && magVarRad !== null) {
    hdgValueRad = hdgMagRad + magVarRad;
    hdgRef = 'T';
  } else if (hdgMagRad !== null) {
    hdgValueRad = hdgMagRad;
    hdgRef = 'M';
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-3">
      <HelmTile label="SOG" value={fmtSpeed(sog)} unit="kn" small />
      <HelmTile
        label="HDG"
        value={fmtHeadingRad(hdgValueRad)}
        unit="°"
        sub={hdgRef ?? undefined}
        small
      />
      <HelmTile label="COG" value={fmtHeading(cog)} unit="°" sub={cogRef ?? undefined} small />
      <HelmTile label="Depth" value={fmtDepth(depth)} unit="m" small />
      <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" small />
      <HelmTile label="TWD" value={fmtHeading(twd)} unit="°" small />
    </div>
  );
}

// Depth is published in metres as a plain scalar — show 1 dp, — when absent.
function fmtDepth(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : v.toFixed(1);
}
