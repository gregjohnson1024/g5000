'use client';
import { useEffect, useState } from 'react';
import type { LivePos } from '../../components/LiveBoatMarker';
import { haversineM } from '../../lib/mob';

interface AnchorState {
  armed: boolean;
  point?: { lat: number; lon: number };
  anchorPoint?: { lat: number; lon: number };
  radiusM: number;
  coneDeg?: number;
  coneCenterDeg?: number;
}

/**
 * Compact anchor-watch card for the chart sidebar.
 *
 * Unarmed: a Drop button (drops at the live boat position) plus a collapsible
 * advanced block — watch radius, anchor offset (distance + bearing from the
 * drop position to where the anchor actually lies) and an optional watch
 * sector. Armed: radius, live distance from the anchor, breach state, and a
 * Weigh button. Polls /api/alarms/anchor every 2 s like the chart layer.
 */
export function AnchorCard({ livePos }: { livePos: LivePos | null }): React.ReactElement | null {
  const [anchor, setAnchor] = useState<AnchorState | null>(null);
  const [breached, setBreached] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [radius, setRadius] = useState('');
  const [offsetM, setOffsetM] = useState('');
  const [offsetBrg, setOffsetBrg] = useState('');
  const [coneDeg, setConeDeg] = useState('');
  const [coneCenter, setConeCenter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms/anchor', { cache: 'no-store' });
        if (stopped) return;
        const body = await r.json();
        if (body?.ok && body.anchor) {
          setAnchor(body.anchor as AnchorState);
          setBreached(body.breached === true);
        }
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  if (!anchor) return null;

  const num = (s: string): number | undefined => {
    const v = Number(s);
    return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
  };

  async function drop(): Promise<void> {
    if (!livePos || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/alarms/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'drop',
          position: { lat: livePos.lat, lon: livePos.lon },
          ...(num(radius) !== undefined ? { radiusM: num(radius) } : {}),
          ...(num(offsetM) !== undefined && num(offsetBrg) !== undefined
            ? { offsetM: num(offsetM), offsetBearingDeg: num(offsetBrg) }
            : {}),
          ...(num(coneDeg) !== undefined ? { coneDeg: num(coneDeg) } : {}),
          ...(num(coneCenter) !== undefined ? { coneCenterDeg: num(coneCenter) } : {}),
        }),
      });
      const body = await r.json();
      if (body?.ok && body.anchor) {
        setAnchor(body.anchor as AnchorState);
        setBreached(false);
      }
    } catch {
      // transient — next click retries
    } finally {
      setBusy(false);
    }
  }

  async function weigh(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/alarms/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'weigh' }),
      });
      const body = await r.json();
      if (body?.ok) {
        setAnchor((prev) => (prev ? { ...prev, armed: false } : prev));
        setBreached(false);
      }
    } catch {
      // transient — next click retries
    } finally {
      setBusy(false);
    }
  }

  const anchorPoint = anchor.anchorPoint ?? anchor.point;
  const distM = anchor.armed && anchorPoint && livePos ? haversineM(livePos, anchorPoint) : null;

  return (
    <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-300 font-semibold uppercase tracking-wide text-[11px]">
          Anchor
        </span>
        {anchor.armed && (
          <span
            className={
              'text-[11px] font-semibold ' + (breached ? 'text-rose-400' : 'text-emerald-400')
            }
          >
            {breached ? 'DRAGGING' : 'watching'}
          </span>
        )}
      </div>

      {anchor.armed ? (
        <>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Radius</span>
            <span className="font-mono">{Math.round(anchor.radiusM)} m</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">From anchor</span>
            <span className="font-mono">{distM === null ? '—' : `${Math.round(distM)} m`}</span>
          </div>
          {anchor.coneDeg !== undefined && anchor.coneDeg < 360 && (
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-400">Sector</span>
              <span className="font-mono">
                {Math.round(anchor.coneDeg)}° @ {Math.round(anchor.coneCenterDeg ?? 0)}°
              </span>
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void weigh()}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            Weigh
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={busy || !livePos}
            onClick={() => void drop()}
            className="w-full rounded border border-sky-600 bg-sky-700 px-2 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
          >
            Drop anchor here
          </button>
          <button
            type="button"
            onClick={() => setShowAdv((v) => !v)}
            className="text-slate-400 hover:text-slate-200"
          >
            {showAdv ? '▾ advanced' : '▸ advanced'}
          </button>
          {showAdv && (
            <div className="space-y-1">
              <AdvRow
                label="Radius m"
                value={radius}
                placeholder={String(anchor.radiusM)}
                onChange={setRadius}
              />
              <AdvRow label="Offset m" value={offsetM} placeholder="0" onChange={setOffsetM} />
              <AdvRow label="Offset °" value={offsetBrg} placeholder="—" onChange={setOffsetBrg} />
              <AdvRow label="Cone °" value={coneDeg} placeholder="360" onChange={setConeDeg} />
              <AdvRow
                label="Cone ctr °"
                value={coneCenter}
                placeholder="—"
                onChange={setConeCenter}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AdvRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 w-16 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-slate-200 placeholder:text-slate-600"
        aria-label={label}
      />
    </div>
  );
}
