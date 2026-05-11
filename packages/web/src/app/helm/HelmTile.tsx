'use client';

import type { ReactNode } from 'react';

export interface HelmTileProps {
  label: string;
  value: string;
  unit?: string;
  /**
   * Optional severity for color-coding (used for %polar):
   *   - 'good' green
   *   - 'ok' amber
   *   - 'bad' red
   *   - 'neutral' (default) white
   */
  severity?: 'good' | 'ok' | 'bad' | 'neutral';
  /** Optional sub-label (e.g. "target" suffix). */
  sub?: string;
  /** When true, render in a smaller size — for less-critical numbers. */
  small?: boolean;
  /** Extra content rendered below the value, typically tiny labels or age. */
  children?: ReactNode;
}

export function HelmTile({
  label,
  value,
  unit,
  severity = 'neutral',
  sub,
  small,
  children,
}: HelmTileProps) {
  const colorByMode: Record<NonNullable<HelmTileProps['severity']>, string> = {
    good: 'text-green-300',
    ok: 'text-amber-300',
    bad: 'text-red-300',
    neutral: 'text-slate-100',
  };
  const valueSize = small ? 'text-4xl' : 'text-6xl';
  const labelSize = small ? 'text-xs' : 'text-sm';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-1">
      <div
        className={`${labelSize} uppercase tracking-wider text-slate-400 flex items-baseline gap-2`}
      >
        <span>{label}</span>
        {sub && <span className="text-slate-600 text-xs normal-case">({sub})</span>}
      </div>
      <div className={`${valueSize} font-mono ${colorByMode[severity]}`}>
        {value}
        {unit && <span className="text-2xl text-slate-500 ml-2">{unit}</span>}
      </div>
      {children}
    </div>
  );
}
