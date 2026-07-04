import type { GridKind } from '@g5000/mast';
import type { ReactNode } from 'react';

const GRID_CLASS: Record<GridKind, string> = {
  '1': 'grid-cols-1 grid-rows-1',
  '2': 'grid-cols-1 grid-rows-2',
  '3': 'grid-cols-1 grid-rows-3',
  '4': 'grid-cols-2 grid-rows-2',
  '6': 'grid-cols-2 grid-rows-3',
};

export function Grid({ grid, children }: { grid: GridKind; children: ReactNode }) {
  return (
    <div className={`grid h-full w-full gap-[1vh] p-[2vh] ${GRID_CLASS[grid]}`}>{children}</div>
  );
}
