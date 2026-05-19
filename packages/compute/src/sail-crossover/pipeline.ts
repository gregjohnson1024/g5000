import { combineLatest, Subscription, type Observable } from 'rxjs';
import { Bus, Channels, snapToFixedGrid, type Cell } from '@g5000/core';
import type { CrossoverSettings, SailCategory, SailWardrobe } from '@g5000/db';
import { findValidSailsByCategory, type ValidByCategory } from './region-lookup.js';

export interface StartArgs {
  bus: Bus;
  sails$: Observable<SailWardrobe>;
  settings$: Observable<CrossoverSettings>;
  /** UNIX seconds; injectable for tests. */
  now?: () => number;
}

interface CategoryTimer {
  outSince: number | null;
  lastActive: string | undefined;
}

const CATEGORIES: SailCategory[] = ['headsail', 'main', 'downwind'];

export function startSailCrossoverPipeline(args: StartArgs): Subscription {
  const now = args.now ?? (() => Math.floor(Date.now() / 1000));
  const timers: Record<SailCategory, CategoryTimer> = {
    headsail: { outSince: null, lastActive: undefined },
    main: { outSince: null, lastActive: undefined },
    downwind: { outSince: null, lastActive: undefined },
  };

  let lastTws: number | null = null;
  let lastTwa: number | null = null;
  let latestWardrobe: SailWardrobe | null = null;
  let latestSettings: CrossoverSettings | null = null;

  const stateSub = combineLatest([args.sails$, args.settings$]).subscribe(([w, s]) => {
    latestWardrobe = w;
    latestSettings = s;
    // Re-evaluate on store changes too (e.g., user repaints a region).
    tryEmit();
  });

  const speedSub = args.bus.subscribe('wind.true.speed', (sample) => {
    if (sample.value.kind !== 'scalar') return;
    lastTws = sample.value.value;
    tryEmit();
  });
  const angleSub = args.bus.subscribe('wind.true.angle', (sample) => {
    if (sample.value.kind !== 'scalar') return;
    lastTwa = sample.value.value;
    tryEmit();
  });

  function tryEmit(): void {
    if (latestWardrobe === null || latestSettings === null) return;
    if (lastTws === null || lastTwa === null) return;
    emit(args.bus, latestWardrobe, latestSettings, lastTws, lastTwa, now(), timers);
  }

  const sub = new Subscription();
  sub.add(stateSub);
  sub.add(() => speedSub());
  sub.add(() => angleSub());
  return sub;
}

function emit(
  bus: Bus,
  wardrobe: SailWardrobe,
  settings: CrossoverSettings,
  twsMs: number,
  twaRad: number,
  t: number,
  timers: Record<SailCategory, CategoryTimer>,
): void {
  const cell: Cell = snapToFixedGrid({ twsMs, twaRad });
  const valid: ValidByCategory = findValidSailsByCategory(wardrobe.sails, cell);
  const changeNeeded = { headsail: false, main: false, downwind: false };

  for (const cat of CATEGORIES) {
    const active = wardrobe.active[cat];
    const timer = timers[cat];
    if (active !== timer.lastActive) {
      timer.outSince = null;
      timer.lastActive = active;
    }
    if (!active) {
      timer.outSince = null;
      continue;
    }
    const inRange = valid[cat].includes(active);
    if (inRange) {
      timer.outSince = null;
    } else {
      if (timer.outSince === null) timer.outSince = t;
      if (t - timer.outSince >= settings.recommendationStableSeconds) {
        changeNeeded[cat] = true;
      }
    }
  }

  bus.publish({
    channel: Channels.SAIL_RECOMMENDATION,
    t_ns: BigInt(t) * 1_000_000_000n,
    value: {
      kind: 'sail_recommendation',
      cellTwsKn: cell.twsIdx, // 1 kn per bin, so idx == knots
      cellTwaDeg: cell.twaIdx * 5,
      valid,
      active: { ...wardrobe.active },
      changeNeeded,
      enteredAt: t,
      stableSeconds: settings.recommendationStableSeconds,
    },
    source: 'compute:sail-crossover',
  });
}
