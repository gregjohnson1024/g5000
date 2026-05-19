import type { Cell } from '@g5000/core';
import { cellKey } from '@g5000/core';
import type { Sail, SailCategory } from '@g5000/db';

export interface ValidByCategory {
  headsail: string[];
  main: string[];
  downwind: string[];
}

export function findValidSailsByCategory(sails: Sail[], cell: Cell): ValidByCategory {
  const key = cellKey(cell);
  const buckets: Record<SailCategory, Sail[]> = { headsail: [], main: [], downwind: [] };
  for (const sail of sails) {
    if (sail.region.cells.includes(key)) buckets[sail.category].push(sail);
  }
  return {
    headsail: buckets.headsail.sort(compareSails).map((s) => s.id),
    main: buckets.main.sort(compareSails).map((s) => s.id),
    downwind: buckets.downwind.sort(compareSails).map((s) => s.id),
  };
}

function compareSails(a: Sail, b: Sail): number {
  const aHasArea = a.areaSqM !== undefined;
  const bHasArea = b.areaSqM !== undefined;
  if (aHasArea && bHasArea) {
    if (b.areaSqM! !== a.areaSqM!) return b.areaSqM! - a.areaSqM!;
    return a.id.localeCompare(b.id);
  }
  if (aHasArea) return -1;
  if (bHasArea) return 1;
  return a.id.localeCompare(b.id);
}
