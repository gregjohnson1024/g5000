'use client';
import { useEffect, useRef, useState } from 'react';

interface Frame {
  t: number;
  pgn: number;
  src: number;
  prio?: number;
  dst?: number;
  fields: Record<string, unknown>;
  /** Client-side id for keying React rows; not from the wire. */
  rowId: number;
}

const DEFAULT_PGNS = '130850';
const MAX_ROWS = 200;

function fmtSrcHex(n: number): string {
  return `0x${n.toString(16).padStart(2, '0')}`;
}

function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Pull out the fields likely to matter for AP-command analysis.
 * Keep the rest available via the raw-JSON expander.
 */
function summary(pgn: number, fields: Record<string, unknown>): string {
  if (pgn === 130850) {
    const ev = fields['Event'];
    const dir = fields['Direction'];
    const angle = fields['Angle'];
    const ctrl = fields['Controlling Device'];
    const propId = fields['Proprietary ID'];
    const parts: string[] = [];
    parts.push(`Event=${JSON.stringify(ev)}`);
    if (dir !== undefined) parts.push(`Dir=${JSON.stringify(dir)}`);
    if (angle !== undefined && angle !== null) parts.push(`Angle=${JSON.stringify(angle)}`);
    if (ctrl !== undefined) parts.push(`Ctrl=${ctrl}`);
    if (propId !== undefined) parts.push(`PropID=${JSON.stringify(propId)}`);
    return parts.join('  ');
  }
  return JSON.stringify(fields);
}

export default function SniffPage() {
  const [pgnsInput, setPgnsInput] = useState<string>(DEFAULT_PGNS);
  const [streaming, setStreaming] = useState<boolean>(true);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [marker, setMarker] = useState<string>('');
  const rowIdRef = useRef(0);
  const [paused, setPaused] = useState(false);

  // Open / re-open the SSE when the PGNs list changes or streaming toggles on.
  useEffect(() => {
    if (!streaming) return;
    const params = encodeURIComponent(pgnsInput);
    const es = new EventSource(`/api/sniff/pgn?pgn=${params}`);
    es.onmessage = (ev) => {
      if (paused) return;
      try {
        const j = JSON.parse(ev.data) as Omit<Frame, 'rowId'>;
        setFrames((prev) => {
          const row: Frame = { ...j, rowId: ++rowIdRef.current };
          const next = [row, ...prev];
          if (next.length > MAX_ROWS) next.length = MAX_ROWS;
          return next;
        });
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, [pgnsInput, streaming, paused]);

  const insertMarker = (): void => {
    if (!marker.trim()) return;
    const label = marker.trim();
    setFrames((prev) => [
      {
        t: Date.now() / 1000,
        pgn: 0,
        src: 0,
        fields: { __marker: label } as Record<string, unknown>,
        rowId: ++rowIdRef.current,
      },
      ...prev,
    ]);
    setMarker('');
  };

  return (
    <main className="p-4 min-h-screen bg-black space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-200">PGN Sniffer</h1>
        <div className="flex gap-2 items-center text-xs">
          <label className="flex items-center gap-1 text-slate-400">
            PGNs (comma-separated)
            <input
              type="text"
              value={pgnsInput}
              onChange={(e) => setPgnsInput(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono w-40 text-slate-200"
            />
          </label>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
          >
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button
            type="button"
            onClick={() => setFrames([])}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="bg-amber-900/30 border border-amber-700 rounded p-3 text-amber-100 text-sm space-y-2">
        <div className="font-semibold">Triton-keypad event capture</div>
        <p>
          Watching PGN 130850 (Simnet: AP command). Press one key on the Triton
          at a time, then drop a marker labeling which key it was. After
          you&apos;ve pressed AUTO / STBY / +1 / −1 / +10 / −10, the
          combinations of <span className="font-mono">Event / Direction / Angle</span>{' '}
          will identify the exact frames to emit back when our control buttons
          fire.
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={marker}
            onChange={(e) => setMarker(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') insertMarker();
            }}
            placeholder="e.g. 'pressed AUTO'"
            className="bg-amber-950/50 border border-amber-700 rounded px-2 py-1 text-amber-100 placeholder-amber-300/60 font-mono text-xs flex-1"
          />
          <button
            type="button"
            onClick={insertMarker}
            disabled={!marker.trim()}
            className="px-3 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 rounded font-medium text-amber-50 text-xs"
          >
            Insert marker
          </button>
        </div>
      </div>

      <div className="border border-slate-800 rounded overflow-hidden bg-slate-900/40">
        <table className="w-full text-xs font-mono">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-left">
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">PGN</th>
              <th className="px-2 py-1">Src</th>
              <th className="px-2 py-1">Summary</th>
            </tr>
          </thead>
          <tbody>
            {frames.map((f) => {
              if (f.fields.__marker) {
                return (
                  <tr key={f.rowId} className="bg-amber-950/40 border-y border-amber-800">
                    <td className="px-2 py-1 text-amber-300">{fmtTime(f.t)}</td>
                    <td className="px-2 py-1 text-amber-300">—</td>
                    <td className="px-2 py-1 text-amber-300">—</td>
                    <td className="px-2 py-1 text-amber-200 font-semibold">
                      ↪ {String(f.fields.__marker)}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={f.rowId} className="border-t border-slate-800/60">
                  <td className="px-2 py-1 text-slate-400">{fmtTime(f.t)}</td>
                  <td className="px-2 py-1 text-slate-200">{f.pgn}</td>
                  <td className="px-2 py-1 text-slate-200">{fmtSrcHex(f.src)}</td>
                  <td className="px-2 py-1 text-slate-200 whitespace-pre-wrap">
                    {summary(f.pgn, f.fields)}
                  </td>
                </tr>
              );
            })}
            {frames.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-slate-500 italic">
                  Waiting for frames…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
