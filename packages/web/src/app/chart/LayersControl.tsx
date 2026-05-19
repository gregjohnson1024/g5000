'use client';

export interface LayersState {
  enc: boolean;
}

/**
 * Top-right toggle button on /chart for the NOAA NCDS chart overlay.
 *
 * When `state.enc` is true, the button shows a filled background to
 * indicate the NOAA chart is on top of the OSM basemap. When false,
 * it's outlined and the chart shows plain OSM.
 *
 * This was previously a popover hosting a Seamarks row plus the
 * NOAA row. The seamarks layer turned out not to be useful in
 * practice, so the popover collapsed to a single toggle. If a
 * second toggle ever lands again, this component goes back to the
 * popover shape — for now, single button is the right scope.
 *
 * The caller (chart/page.tsx) owns state and persists it to
 * localStorage under `chart:layers`.
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}) {
  const on = state.enc;
  return (
    <button
      type="button"
      aria-label="Toggle NOAA chart overlay"
      aria-pressed={on}
      onClick={() => onToggle('enc')}
      className={
        'absolute top-2 right-2 z-10 px-3 h-9 rounded border text-sm font-medium ' +
        (on
          ? 'bg-zinc-100 text-zinc-900 border-zinc-100 hover:bg-zinc-200'
          : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
      }
    >
      NOAA
    </button>
  );
}
