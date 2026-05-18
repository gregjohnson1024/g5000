'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSse } from '../../hooks/use-sse';

interface LineEnd { lat: number; lon: number; pingedAt: string }
interface LineSnap { port?: LineEnd; stbd?: LineEnd; preStartSide?: 'port' | 'stbd' }

function fmtCoord(lat: number, lon: number): string {
  const fL = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const deg = Math.floor(a);
    const min = ((a - deg) * 60).toFixed(3);
    return `${deg} ${min}${v >= 0 ? pos : neg}`;
  };
  return `${fL(lat, 'n', 's')}, ${fL(lon, 'e', 'w')}`;
}

export function LinePingPanel(): React.ReactElement {
  const [line, setLine] = useState<LineSnap>({});
  const [confirming, setConfirming] = useState(false);
  const { channels } = useSse();

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setLine(j.line ?? {});
      } catch { /* retry */ }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  const ping = useCallback(async (end: 'port' | 'stbd') => {
    const pos = channels.get('nav.gps.position');
    if (!pos || pos.value.kind !== 'geo') {
      alert('No GPS position available');
      return;
    }
    const position = pos.value.value;
    // Boat position at ping time matches the ping position itself for the
    // common case (you're standing at the end). The /api/race/line handler
    // uses boatPos to determine preStartSide on the second ping.
    await fetch('/api/race/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping', end, position, boatPos: position }),
    });
    const r = await fetch('/api/race/state', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setLine(j.line ?? {});
    }
  }, [channels]);

  const clear = useCallback(async () => {
    await fetch('/api/race/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    setConfirming(false);
    setLine({});
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">Start line</div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void ping('port')}
          className="bg-emerald-700 hover:bg-emerald-600 text-white rounded p-4 text-lg font-semibold"
        >
          Ping Port End
          {line.port && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtCoord(line.port.lat, line.port.lon)}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => void ping('stbd')}
          className="bg-rose-700 hover:bg-rose-600 text-white rounded p-4 text-lg font-semibold"
        >
          Ping Stbd End
          {line.stbd && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtCoord(line.stbd.lat, line.stbd.lon)}
            </div>
          )}
        </button>
      </div>
      {line.port && line.stbd && !line.preStartSide && (
        <div className="text-xs text-amber-400 font-mono">
          motor off the line — pre-start side will set automatically
        </div>
      )}
      {line.preStartSide && (
        <div className="text-xs text-slate-400 font-mono">
          pre-start side: {line.preStartSide}
        </div>
      )}
      {(line.port || line.stbd) && (
        <>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="self-end text-xs text-red-400 underline"
            >
              Clear line
            </button>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-red-400">Clear both ends?</span>
              <button
                type="button"
                onClick={() => void clear()}
                className="text-xs px-2 py-1 bg-red-700 text-white rounded"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs px-2 py-1 bg-slate-700 text-slate-200 rounded"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
