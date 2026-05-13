'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import type { SailWardrobe } from '@g5000/db';
import { useSse } from '../../hooks/use-sse';
import { HelmTile } from './HelmTile';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function fmtSpeed(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${(v * MS_TO_KNOTS).toFixed(1)}`;
}

function fmtAngleSigned(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(0)}`;
}

function fmtHeading(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  let deg = v * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(0)}`;
}

export default function HelmPage() {
  const { channels, connected } = useSse();
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);

  const reloadWardrobe = useCallback(async () => {
    try {
      const r = await fetch('/api/sails', { cache: 'no-store' });
      if (!r.ok) return;
      setWardrobe((await r.json()) as SailWardrobe);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reloadWardrobe();
  }, [reloadWardrobe]);

  const swapActive = async (configId: string) => {
    await fetch('/api/sails/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId }),
    });
    await reloadWardrobe();
  };

  // Wind + polar/VMG channels intentionally not subscribed — no wind sensor attached.
  const sog = channels.get('nav.gps.sog');
  // COG and HDG: each can arrive in either True or Magnetic reference.
  // Pick whichever has fresh data, and remember which one to label the tile.
  const cogTrue = channels.get('nav.gps.cog');
  const cogMag = channels.get('nav.gps.cog.magnetic');
  const cog = cogTrue ?? cogMag;
  const cogRef = cogTrue ? 'T' : cogMag ? 'M' : null;
  const hdgMag = channels.get('boat.heading.magnetic');
  const hdgTrue = channels.get('boat.heading.true');
  const hdg = hdgMag ?? hdgTrue;
  const hdgRef = hdgMag ? 'M' : hdgTrue ? 'T' : null;
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');

  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Helm</h1>
        <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
      </div>

      {wardrobe && (
        <div className="flex items-center gap-2 mb-3 text-sm bg-slate-900 border border-slate-800 rounded px-3 py-2">
          <span className="text-slate-400">Sails:</span>
          <select
            value={wardrobe.activeConfigId}
            onChange={(e) => swapActive(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-1 text-sm"
          >
            {wardrobe.configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)?.daggerboard && (
            <span className="px-2 py-0.5 rounded bg-amber-700 text-amber-100 text-xs font-mono uppercase">
              boards{' '}
              {wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)?.daggerboard}
            </span>
          )}
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage
          </a>
        </div>
      )}

      {/* Wind-derived tiles (TWS/TWA/AWA, Target speed, % polar, VMG, Target VMG)
          hidden — no wind sensor attached. Re-add when masthead is wired. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HelmTile label="SOG" value={fmtSpeed(sog)} unit="kn" />
        <HelmTile
          label="COG"
          value={fmtHeading(cog)}
          unit="°"
          sub={cogRef ?? undefined}
        />
        <HelmTile
          label="HDG"
          value={fmtHeading(hdg)}
          unit="°"
          sub={hdgRef ?? undefined}
        />

        <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
        <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />
      </div>
    </main>
  );
}
