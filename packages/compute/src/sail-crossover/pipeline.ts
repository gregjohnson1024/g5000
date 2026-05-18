import { combineLatest, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { Channels, type Bus, type Sample } from '@g5000/core';
import type { CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe } from '@g5000/db';
import { lookupConfigId, snapToCell } from './lookup.js';

/**
 * Published shape on Channels.SAIL_RECOMMENDATION. Consumers (helm tile,
 * recommendation panel) compute `shouldChange` themselves on each render:
 *
 *   shouldChange = recommendedConfigId
 *               && recommendedConfigId !== activeConfigId
 *               && (Date.now()/1000 - enteredAt) >= stableSeconds
 *
 * This avoids a class of RxJS bugs where the pipeline doesn't re-fire
 * after wind stabilises so the in-pipeline maturation timer never trips.
 */
export interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  /** Index into the active polar's twsBins. */
  cellTwsIdx: number;
  /** Index into the active polar's twaBins. */
  cellTwaIdx: number;
  /** UNIX seconds when this recommendedConfigId was first observed. Resets
   *  to "now" when the recommendation flips to a different config. */
  enteredAt: number;
  /** Echoed from CrossoverSettings so the UI can compute shouldChange. */
  stableSeconds: number;
}

/** Minimal store shape used by the pipeline — duck-typed for testability. */
export interface CrossoverPipelineStore {
  activePolar$: Observable<PolarTable>;
  sails$: Observable<SailWardrobe>;
  crossoverMap$: Observable<CrossoverMap>;
  crossoverSettings$: Observable<CrossoverSettings>;
}

interface WindLatest {
  tws: number | null;
  twa: number | null;
  tNs: bigint;
}

export function startSailCrossoverPipeline(args: {
  bus: Bus;
  store: CrossoverPipelineStore;
}): () => void {
  const { bus, store } = args;
  const wind$ = new Subject<WindLatest>();
  let twsLatest: number | null = null;
  let twaLatest: number | null = null;

  const unsubTws = bus.subscribe('wind.true.speed', (s: Sample) => {
    if (s.value.kind !== 'scalar') return;
    twsLatest = s.value.value;
    wind$.next({ tws: twsLatest, twa: twaLatest, tNs: s.t_ns });
  });
  const unsubTwa = bus.subscribe('wind.true.angle', (s: Sample) => {
    if (s.value.kind !== 'scalar') return;
    twaLatest = s.value.value;
    wind$.next({ tws: twsLatest, twa: twaLatest, tNs: s.t_ns });
  });

  let lastCandidate: string | null = null;
  let candidateSince = 0;

  const sub = combineLatest([
    store.activePolar$,
    store.sails$,
    store.crossoverMap$,
    store.crossoverSettings$,
    wind$,
  ]).subscribe(([polar, wardrobe, map, settings, w]) => {
    if (w.tws === null || w.twa === null) return;
    const cell = snapToCell(polar, w.tws, w.twa);
    const recommended = lookupConfigId(map, polar, w.tws, w.twa);
    const nowSec = Math.floor(Date.now() / 1000);
    if (recommended !== lastCandidate) {
      lastCandidate = recommended;
      candidateSince = nowSec;
    }
    const payload: SailRecommendation = {
      recommendedConfigId: recommended,
      activeConfigId: wardrobe.activeConfigId,
      cellTwsIdx: cell.twsIdx,
      cellTwaIdx: cell.twaIdx,
      enteredAt: candidateSince,
      stableSeconds: settings.recommendationStableSeconds,
    };
    bus.publish({
      channel: Channels.SAIL_RECOMMENDATION,
      source: 'compute:sail-crossover',
      t_ns: BigInt(nowSec) * 1_000_000_000n,
      value: { kind: 'sail_recommendation', ...payload },
    });
  });

  return () => {
    sub.unsubscribe();
    unsubTws();
    unsubTwa();
  };
}
