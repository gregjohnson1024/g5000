'use client';

import type { JsonSafeSample } from '@g5000/core';
import { CellGrid } from '../../components/ui/CellGrid';
import { scalar, fmtSpeed, fmtHeading, fmtHeadingRad, sampleTs } from './tile-helpers';

/** The six pinned tiles shown on every helm group — hairline CellGrid instrument wall. */
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

  const hdgTrue = channels.get('boat.heading.true');
  const hdgMag = channels.get('boat.heading.magnetic');
  const magVar = channels.get('nav.magvar');
  const hdgTrueRad = scalar(hdgTrue);
  const hdgMagRad = scalar(hdgMag);
  const magVarRad = scalar(magVar);
  let hdgValueRad: number | null = null;
  let hdgRef: 'T' | 'M' | null = null;
  let hdgSample: JsonSafeSample | undefined;
  if (hdgTrueRad !== null) {
    hdgValueRad = hdgTrueRad;
    hdgRef = 'T';
    hdgSample = hdgTrue;
  } else if (hdgMagRad !== null && magVarRad !== null) {
    hdgValueRad = hdgMagRad + magVarRad;
    hdgRef = 'T';
    hdgSample = hdgMag;
  } else if (hdgMagRad !== null) {
    hdgValueRad = hdgMagRad;
    hdgRef = 'M';
    hdgSample = hdgMag;
  }

  return (
    <CellGrid
      label="CORE"
      cols={{ base: 3, md: 6 }}
      className="mb-3"
      data-testid="core-strip"
      cells={[
        { label: 'SOG', value: fmtSpeed(sog), unit: 'kn', small: true, tMs: sampleTs(sog) },
        {
          label: 'HDG',
          value: fmtHeadingRad(hdgValueRad),
          unit: '°',
          sub: hdgRef ?? undefined,
          small: true,
          tMs: sampleTs(hdgSample),
        },
        {
          label: 'COG',
          value: fmtHeading(cog),
          unit: '°',
          sub: cogRef ?? undefined,
          small: true,
          tMs: sampleTs(cog),
        },
        { label: 'Depth', value: fmtDepth(depth), unit: 'm', small: true, tMs: sampleTs(depth) },
        { label: 'TWS', value: fmtSpeed(tws), unit: 'kn', small: true, tMs: sampleTs(tws) },
        { label: 'TWD', value: fmtHeading(twd), unit: '°', small: true, tMs: sampleTs(twd) },
      ]}
    />
  );
}

// Depth is published in metres as a plain scalar — show 1 dp, — when absent.
function fmtDepth(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : v.toFixed(1);
}
