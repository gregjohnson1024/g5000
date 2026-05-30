'use client';
import { useEffect } from 'react';
import type { ContextTarget, HitWaypoint } from '../../lib/route-hit-test';

export interface ChartContextMenuProps {
  target: ContextTarget;
  screen: { x: number; y: number };
  onClose: () => void;
  onAddToRoute: (id: string) => void;
  onRemoveFromRoute: (id: string) => void;
  onSetStart: (id: string) => void;
  onSetEnd: (id: string) => void;
  onDeleteWaypoint: (wp: HitWaypoint) => void;
  onAddHere: (lat: number, lon: number) => void;
  onRouteToHere: (lat: number, lon: number) => void;
  onInsertHere: (lat: number, lon: number, insertIndex: number) => void;
  onClearRoute: () => void;
}

const ITEM = 'w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700 whitespace-nowrap';

export function ChartContextMenu(p: ChartContextMenuProps): React.ReactElement {
  useEffect(() => {
    const close = () => p.onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', close, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', close, { capture: true });
    };
  }, [p]);

  const t = p.target;
  const items: React.ReactNode[] = [];
  const item = (label: string, fn: () => void) =>
    items.push(
      <button
        key={label}
        className={ITEM}
        onClick={() => {
          fn();
          p.onClose();
        }}
      >
        {label}
      </button>,
    );

  if (t.kind === 'waypoint') {
    const w = t.waypoint;
    if (t.inRoute) item(`Remove ${w.name} from route`, () => p.onRemoveFromRoute(w.id));
    else item(`Add ${w.name} to route`, () => p.onAddToRoute(w.id));
    item(`Set ${w.name} as start`, () => p.onSetStart(w.id));
    item(`Set ${w.name} as destination`, () => p.onSetEnd(w.id));
    item(`Delete ${w.name}`, () => p.onDeleteWaypoint(w));
  } else if (t.kind === 'leg') {
    item('Insert waypoint here', () => p.onInsertHere(t.lat, t.lon, t.insertIndex));
  } else {
    item('Add waypoint here', () => p.onAddHere(t.lat, t.lon));
    item('Route to here', () => p.onRouteToHere(t.lat, t.lon));
    item('Clear route', () => p.onClearRoute());
  }

  return (
    <div
      className="absolute z-50 bg-slate-900 border border-slate-700 rounded shadow-lg py-1"
      style={{ left: p.screen.x, top: p.screen.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items}
    </div>
  );
}
