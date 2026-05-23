'use client';
import type { Orientation } from './use-chart-camera';

/**
 * Top-left chart-page controls: Follow toggle + Orientation cycle.
 *
 * Stateless — all state lives in `useChartCamera`. This component just
 * renders the current values and reports clicks.
 *
 * When `hasFix` is false (no GPS fix yet), both buttons render in a
 * disabled style; the click handlers are still wired but the parent's
 * follow logic will no-op without a position.
 */
export function ChartFollowControl({
  follow,
  orientation,
  hasFix,
  onToggleFollow,
  onCycleOrientation,
}: {
  follow: boolean;
  orientation: Orientation;
  hasFix: boolean;
  onToggleFollow: () => void;
  onCycleOrientation: () => void;
}) {
  const followLabel = follow ? '⊙ Follow' : '⊕ Follow';
  const orientationLabel =
    orientation === 'north' ? 'N' : orientation === 'course' ? '↑COG' : '↑HDG';

  const baseBtn = 'px-3 py-1.5 text-sm rounded border shadow w-[110px] text-left';
  const enabledFollow = follow
    ? 'bg-slate-100 text-slate-900 border-slate-100 hover:bg-slate-200'
    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';
  const enabledOrientation = 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';
  const disabled = 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed';

  return (
    <div className="absolute top-3 left-3 flex flex-col gap-2 items-start z-10">
      <button
        type="button"
        aria-pressed={follow}
        aria-label="Toggle follow vessel"
        onClick={onToggleFollow}
        disabled={!hasFix}
        className={`${baseBtn} ${hasFix ? enabledFollow : disabled}`}
        title={follow ? 'Currently following — tap to release' : 'Tap to follow the boat'}
      >
        {followLabel}
      </button>
      <button
        type="button"
        aria-label={`Orientation: ${orientationLabel}, tap to cycle`}
        onClick={onCycleOrientation}
        disabled={!hasFix}
        className={`${baseBtn} ${hasFix ? enabledOrientation : disabled}`}
        title="Cycle: North up → Course up → Heading up"
      >
        {orientationLabel}
      </button>
    </div>
  );
}
