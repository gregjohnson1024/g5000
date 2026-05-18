import { auditTime, firstValueFrom, Subject, Subscription, type Observable } from 'rxjs';
import type { Bus, ChannelValue } from '@g5000/core';
import type { SailWardrobe, WardrobeSettings } from '@g5000/db';
import { interpolatePolarSpeed } from '../polars/math.js';

const MS_TO_KN = 1 / 0.514444;
const STALE_MS = 30_000;

export interface SailRecommendation {
  recommendedConfigId: string | null;
  recommendedSpeedKn: number | null;
  activeConfigId: string;
  activeSpeedKn: number | null;
  /** (recommendedSpeed − activeSpeed) / activeSpeed × 100. 0 when equal. */
  gapPercent: number;
  shouldChange: boolean;
  /** True when no fresh wind sample in STALE_MS; values are last known-good. */
  stale: boolean;
}

/**
 * Minimal store shape the pipeline depends on. Decoupled from ConfigStore's
 * full surface so tests can pass a tiny BehaviorSubject-based stub.
 */
export interface PipelineStore {
  sails$: Observable<SailWardrobe>;
  wardrobeSettings$: Observable<WardrobeSettings>;
}

export interface PipelineOpts {
  bus: Bus;
  configStore: PipelineStore;
}

interface LatestWind {
  tws_ms: number;
  twa_rad: number;
  t_ns: bigint;
}

/**
 * Subscribes to wind.true.speed + wind.true.angle, combines with the active
 * wardrobe + settings, computes per-tick argmax over the configs, and
 * publishes a SailRecommendation on the wardrobe.recommendation channel.
 *
 * Throttled with auditTime(500ms) — live wind can fire 10×/sec; the panel
 * doesn't need that. Stale-wind detection (no fresh sample in 30 s) flips
 * the `stale` flag but keeps publishing the last known-good values so the
 * UI can fall back gracefully.
 *
 * Pattern follows the existing `startPolarPipeline`: read the initial
 * wardrobe + settings via firstValueFrom (resolves synchronously for
 * BehaviorSubject-backed observables), then subscribe to update the cached
 * locals. The Bus's `subscribe(pattern, cb)` API doesn't return an
 * Observable, so we bridge wind samples into a local Subject and pipe
 * THAT through auditTime.
 *
 * NOTE: `wardrobe.recommendation` carries a structured `SailRecommendation`
 * payload that does not match any existing `ChannelValue` variant (scalar /
 * vec3 / quat / geo / enum). We publish it as-is via a type cast — the SSE
 * writer just `JSON.stringify`s `sample.value`, and consumers that filter
 * by `s.value.kind` will simply ignore this channel (intentional — only
 * the recommendation panel/tile should read it). If a future need arises
 * for typed structured-payload channels, a `{ kind: 'json'; value: unknown }`
 * variant in `ChannelValue` would be the clean fix.
 */
export async function startSailRecommendationPipeline(
  opts: PipelineOpts,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  let latestWind: LatestWind | null = null;
  let lastEmittedAt = 0;

  // Cache the current wardrobe + settings locally — same pattern as
  // packages/compute/src/polars/pipeline.ts.
  let wardrobe: SailWardrobe = await firstValueFrom(configStore.sails$);
  let settings: WardrobeSettings = await firstValueFrom(configStore.wardrobeSettings$);

  const busUnsubs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  // Keep wardrobe + settings fresh as the user edits them via /sails.
  rxSubs.push(configStore.sails$.subscribe((w) => (wardrobe = w)));
  rxSubs.push(configStore.wardrobeSettings$.subscribe((s) => (settings = s)));

  // Wind sample bridge: Bus → local Subject (so we can pipe auditTime).
  const windTick$ = new Subject<void>();
  busUnsubs.push(
    bus.subscribe('wind.true.speed', (s) => {
      if (s.value.kind !== 'scalar') return;
      latestWind = {
        tws_ms: s.value.value,
        twa_rad: latestWind?.twa_rad ?? 0,
        t_ns: s.t_ns,
      };
      windTick$.next();
    }),
  );
  busUnsubs.push(
    bus.subscribe('wind.true.angle', (s) => {
      if (s.value.kind !== 'scalar') return;
      latestWind = {
        tws_ms: latestWind?.tws_ms ?? 0,
        twa_rad: s.value.value,
        t_ns: s.t_ns,
      };
      windTick$.next();
    }),
  );

  function recompute(stale: boolean): SailRecommendation | null {
    if (!latestWind) return null;

    const tws = latestWind.tws_ms;
    const twa = Math.abs(latestWind.twa_rad);
    let best: { id: string; kn: number } | null = null;
    let activeKn: number | null = null;
    for (const c of wardrobe.configs) {
      const bspMs = interpolatePolarSpeed(c.polar, tws, twa);
      if (!Number.isFinite(bspMs) || bspMs <= 0) continue;
      const kn = bspMs * MS_TO_KN;
      if (c.id === wardrobe.activeConfigId) activeKn = kn;
      if (!best || kn > best.kn) best = { id: c.id, kn };
    }
    const recommendedConfigId = best?.id ?? null;
    const recommendedSpeedKn = best?.kn ?? null;
    const activeConfigId = wardrobe.activeConfigId;
    const activeSpeedKn = activeKn;
    const gapPercent =
      recommendedSpeedKn !== null && activeSpeedKn && activeSpeedKn > 0
        ? ((recommendedSpeedKn - activeSpeedKn) / activeSpeedKn) * 100
        : 0;
    const shouldChange =
      recommendedConfigId !== null &&
      recommendedConfigId !== activeConfigId &&
      gapPercent > settings.hysteresisPercent;
    return {
      recommendedConfigId,
      recommendedSpeedKn,
      activeConfigId,
      activeSpeedKn,
      gapPercent,
      shouldChange,
      stale,
    };
  }

  function publish(rec: SailRecommendation): void {
    bus.publish({
      channel: 'wardrobe.recommendation',
      // SailRecommendation is a structured payload not modelled by any
      // existing ChannelValue variant; cast through unknown. See the
      // comment at the top of this file.
      value: rec as unknown as ChannelValue,
      source: 'sail-crossover-pipeline',
      t_ns: BigInt(Date.now()) * 1_000_000n,
    });
    lastEmittedAt = Date.now();
  }

  // Audit-throttle: fire at most every 500 ms while wind ticks arrive.
  rxSubs.push(
    windTick$.pipe(auditTime(500)).subscribe(() => {
      const rec = recompute(false);
      if (rec) publish(rec);
    }),
  );

  // Stale watchdog — every 1 s, if last emit was > STALE_MS ago, re-emit
  // the last computed recommendation with stale: true so the UI can dim.
  const staleTimer = setInterval(() => {
    if (!lastEmittedAt) return;
    if (Date.now() - lastEmittedAt < STALE_MS) return;
    const rec = recompute(true);
    if (rec) publish(rec);
  }, 1000);

  return async () => {
    for (const u of busUnsubs) u();
    for (const s of rxSubs) s.unsubscribe();
    clearInterval(staleTimer);
  };
}
