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
    <div className="space-y-2 bg-surface/60 border border-hairline rounded p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-ink font-semibold uppercase tracking-wide text-xs">Anchor</span>
        {anchor.armed && (
          <span className={`text-xs font-semibold ${breached ? 'text-danger' : 'text-ok'}`}>
            {breached ? 'DRAGGING' : 'watching'}
          </span>
        )}
      </div>

      {anchor.armed ? (
        <>
          <div className="flex items-center justify-between text-ink">
            <span className="text-ink-3">Radius</span>
            <span className="font-mono">{Math.round(anchor.radiusM)} m</span>
          </div>
          <div className="flex items-center justify-between text-ink">
            <span className="text-ink-3">From anchor</span>
            <span className="font-mono">{distM === null ? '—' : `${Math.round(distM)} m`}</span>
          </div>
          {anchor.coneDeg !== undefined && anchor.coneDeg < 360 && (
            <div className="flex items-center justify-between text-ink">
              <span className="text-ink-3">Sector</span>
              <span className="font-mono">
                {Math.round(anchor.coneDeg)}° @ {Math.round(anchor.coneCenterDeg ?? 0)}°
              </span>
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void weigh()}
            className="w-full rounded border border-hairline bg-surface-raised px-2 py-1 font-semibold text-ink hover:brightness-95 disabled:opacity-40"
          >
            Weigh
          </button>
        </>
      ) : (
        <>
          {/* Primary action: amber accent per one-accent rule */}
          <button
            type="button"
            disabled={busy || !livePos}
            onClick={() => void drop()}
            className="w-full rounded border border-accent bg-accent px-2 py-1 font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-40"
          >
            Drop anchor here
          </button>
          <button
            type="button"
            onClick={() => setShowAdv((v) => !v)}
            className="text-ink-3 hover:text-ink"
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
      <span className="text-ink-3 w-16 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-hairline bg-surface-raised px-1.5 py-0.5 font-mono text-ink placeholder:text-ink-4"
        aria-label={label}
      />
    </div>
  );
}
