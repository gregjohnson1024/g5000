'use client';
import { useEffect, useRef, useState } from 'react';

export interface LayersState {
  seamarks: boolean;
}

const LAYERS: { key: keyof LayersState; label: string }[] = [
  { key: 'seamarks', label: 'Seamarks' },
];

/**
 * Top-right popover on /chart for toggling map overlay layers.
 *
 * Designed to grow: adding a new row is one entry in the LAYERS
 * array plus a key on LayersState. v1 ships with just Seamarks
 * (OpenSeaMap buoys / lights / harbour limits).
 *
 * The caller owns state and persistence (chart/page.tsx writes to
 * localStorage under `chart:layers`).
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div
      ref={ref}
      className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1"
    >
      <button
        type="button"
        aria-label="Layers"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded bg-zinc-900/85 text-zinc-100 border border-zinc-700 hover:bg-zinc-800 flex items-center justify-center"
      >
        {/* Stacked-layers glyph */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
      {open && (
        <div className="min-w-[140px] rounded bg-zinc-900/95 text-zinc-100 border border-zinc-700 shadow-lg p-2">
          {LAYERS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-zinc-800 rounded"
            >
              <input
                type="checkbox"
                checked={state[key]}
                onChange={() => onToggle(key)}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
