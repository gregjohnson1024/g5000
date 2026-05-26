'use client';
import type { PlaybackState } from '../../lib/route-playback';

const MS_TO_KN = 1.94384;
const RAD_TO_DEG = 180 / Math.PI;
const deg = (rad: number): string => `${Math.round((((rad * RAD_TO_DEG) % 360) + 360) % 360)}° T`;
const kn = (ms: number): string => `${(ms * MS_TO_KN).toFixed(1)} kn`;

export function RouteDetailsBox(props: {
  model: string;
  color: string;
  state: PlaybackState | null;
}) {
  const s = props.state;
  return (
    <div className="text-xs border rounded p-2 space-y-0.5" style={{ borderColor: props.color }}>
      <div className="font-semibold" style={{ color: props.color }}>
        {props.model}
        {s?.atEnd ? ' · arrived' : s?.beforeStart ? ' · pre-start' : ''}
      </div>
      <div className="font-mono grid grid-cols-2 gap-x-3">
        <span>SOG {s ? kn(s.sog) : '—'}</span>
        <span>BSP {s ? kn(s.bsp) : '—'}</span>
        <span>COG {s ? deg(s.cog) : '—'}</span>
        <span>HDG {s ? deg(s.hdg) : '—'}</span>
      </div>
    </div>
  );
}
