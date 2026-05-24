import { type SailCategory, type SailWardrobe } from '@g5000/db';

// Inline constant avoids pulling @g5000/db (better-sqlite3) into the client bundle.
const SAIL_CATEGORIES: readonly SailCategory[] = ['headsail', 'main', 'downwind'] as const;

export interface SailGroup {
  category: SailCategory;
  label: string;
  sails: Array<{ id: string; name: string }>;
  activeId?: string;
}

const LABELS: Record<SailCategory, string> = {
  headsail: 'Headsail',
  main: 'Main',
  downwind: 'Downwind',
};

export function sailGroups(wardrobe: SailWardrobe): SailGroup[] {
  return SAIL_CATEGORIES.map((category) => ({
    category,
    label: LABELS[category],
    sails: wardrobe.sails
      .filter((s) => s.category === category)
      .map((s) => ({ id: s.id, name: s.name })),
    activeId: wardrobe.active[category],
  }));
}
