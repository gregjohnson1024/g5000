'use client';
import { LayersControl, type LayersState } from './LayersControl';
import type { ChartModel } from './model-layer';
import { AnnotationDropper } from '../../components/AnnotationDropper';

export interface ChartToolbarProps {
  layers: LayersState;
  onToggleLayer: (key: 'osm' | 'enc' | 'satellite' | 'buoys' | 'bathy' | 'ais' | 'aisCog') => void;
  onSelectModel: (model: ChartModel) => void;
  waypointDropActive: boolean;
  onToggleWaypointDrop: () => void;
}

export function ChartToolbar({
  layers,
  onToggleLayer,
  onSelectModel,
  waypointDropActive,
  onToggleWaypointDrop,
}: ChartToolbarProps): React.ReactElement {
  return (
    <div className="absolute top-2 right-2 z-10 flex flex-col gap-2 items-end">
      <LayersControl state={layers} onToggle={onToggleLayer} onSelectModel={onSelectModel} />
      <AnnotationDropper variant="icon" />
      <button
        type="button"
        aria-pressed={waypointDropActive}
        aria-label={waypointDropActive ? 'Cancel waypoint drop' : 'Drop a waypoint'}
        title={
          waypointDropActive
            ? 'Click the map to drop a waypoint (Esc to cancel)'
            : 'Drop a waypoint on the chart'
        }
        onClick={onToggleWaypointDrop}
        className={
          'w-9 h-9 rounded border flex items-center justify-center ' +
          (waypointDropActive
            ? 'bg-amber-500 text-zinc-900 border-amber-600 hover:bg-amber-400'
            : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
        }
      >
        <WaypointIcon />
      </button>
    </div>
  );
}

function WaypointIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}
