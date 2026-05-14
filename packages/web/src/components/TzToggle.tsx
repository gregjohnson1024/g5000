'use client';
import type { TzMode } from '../lib/tz';

/**
 * Two-button group that toggles a page between UTC and Local display.
 * The owning page holds the `tz` state and decides where to put the
 * toggle in its layout.
 */
export function TzToggle({
  tz,
  setTz,
}: {
  tz: TzMode;
  setTz: (v: TzMode) => void;
}) {
  const base = 'px-2 py-1 text-xs font-mono';
  return (
    <div
      role="group"
      aria-label="Timezone display"
      className="inline-flex rounded border border-slate-700 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setTz('utc')}
        className={`${base} ${tz === 'utc' ? 'bg-amber-700 text-amber-100' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
        title="Show and interpret times in UTC"
      >
        UTC
      </button>
      <button
        type="button"
        onClick={() => setTz('local')}
        className={`${base} ${tz === 'local' ? 'bg-amber-700 text-amber-100' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
        title="Show and interpret times in this device's local zone"
      >
        Local
      </button>
    </div>
  );
}
