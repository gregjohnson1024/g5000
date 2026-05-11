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

function fmtPercent(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${v.toFixed(0)}`;
}

function percentSeverity(s: JsonSafeSample | undefined): 'good' | 'ok' | 'bad' | 'neutral' {
  const v = scalar(s);
  if (v === null) return 'neutral';
  if (v >= 95) return 'good';
  if (v >= 80) return 'ok';
  return 'bad';
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

  const tws = channels.get('wind.true.speed');
  const twa = channels.get('wind.true.angle');
  const awa = channels.get('wind.apparent.angle');
  const bsp = channels.get('boat.speed.water');
  const targetSpeed = channels.get('performance.target.boatSpeed');
  const percentPolar = channels.get('performance.percentPolar');
  const vmg = channels.get('performance.vmg');
  const targetVmg = channels.get('performance.target.vmg');
  const hdg = channels.get('boat.heading.magnetic');
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');
  const rot = channels.get('motion.rateOfTurn');

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
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" />
        <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />
        <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />

        <HelmTile label="BSP" value={fmtSpeed(bsp)} unit="kn" />
        <HelmTile label="Target speed" value={fmtSpeed(targetSpeed)} unit="kn" sub="polar" />
        <HelmTile
          label="% polar"
          value={fmtPercent(percentPolar)}
          unit="%"
          severity={percentSeverity(percentPolar)}
        />

        <HelmTile label="VMG" value={fmtSpeed(vmg)} unit="kn" />
        <HelmTile label="Target VMG" value={fmtSpeed(targetVmg)} unit="kn" sub="polar" />
        <HelmTile label="Heading" value={fmtHeading(hdg)} unit="°" />

        <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
        <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />
        <HelmTile label="Rate of turn" value={fmtAngleSigned(rot)} unit="°/s" small />
      </div>
    </main>
  );
}
