/**
 * ramp.ts — canonical colour ramp module for HeatmapGrid + RampLegend.
 *
 * CANONICAL-RAMP LAW: the legend MUST derive from the same stops array that
 * the grid renders. Pass stops once; both sides use it. This prevents legend
 * and grid drifting apart (the bug described in the overhaul keep-list and
 * WindLegend seed).
 *
 * Two modes:
 *   sequential — maps [0, 1] → --seq-1..6 (navy→red). Reads var() at
 *               runtime so it re-themes without a rerender.
 *   diverging  — symmetric around 0, negative side blue (--seq-1..3),
 *               positive side orange-red (--seq-4..6). Used by CalHeatmap.
 *
 * Night repaint: colours are read via getComputedStyle at call time.  A parent
 * that wants live night-mode repaints should call colourForStop() inside a
 * useEffect that subscribes to the theme attribute — or simply force a re-render
 * when [data-theme] changes (ThemeController already does this).
 */

export type RampMode = 'sequential' | 'diverging';

/** A single stop: [normalised position 0..1, CSS colour string] */
export type RampStop = readonly [number, string];

/** Token names for the sequential ramp, in order. */
const SEQ_TOKENS = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6'] as const;

/**
 * Resolve a CSS custom-property token value at call time.
 * Falls back to the supplied hex literal if getComputedStyle is unavailable
 * (e.g. SSR / unit tests).
 */
export function resolveToken(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

/** DAY-theme fallback hex values for --seq-1..6 (for SSR / test contexts). */
const SEQ_FALLBACKS: readonly string[] = [
  '#0c4a6e',
  '#0284c7',
  '#38bdf8',
  '#fde047',
  '#f97316',
  '#dc2626',
];

/**
 * Build the canonical stop array for the given mode.
 *
 * sequential: 6 stops at positions 0, 0.2, 0.4, 0.6, 0.8, 1.0
 * diverging:  7 stops: -1(seq-1), -0.6(seq-2), -0.2(seq-3),
 *              0(slack), +0.2(seq-4), +0.6(seq-5), +1.0(seq-6)
 *
 * Position semantics:
 *   sequential: fraction of value range [min, max]
 *   diverging:  fraction of symmetric range [-maxAbs, +maxAbs]; 0 is centre
 */
export function buildStops(mode: RampMode): RampStop[] {
  const seqColour = (i: number) => resolveToken(SEQ_TOKENS[i]!, SEQ_FALLBACKS[i]!);

  if (mode === 'sequential') {
    return SEQ_TOKENS.map((_, i) => [i / (SEQ_TOKENS.length - 1), seqColour(i)] as RampStop);
  }

  // diverging
  const slack = resolveToken('--flow-slack', '#64748b');
  return [
    [0.0, seqColour(0)], // -1 → seq-1
    [0.2, seqColour(1)], // -0.6 → seq-2
    [0.4, seqColour(2)], // -0.2 → seq-3
    [0.5, slack], //  0  → slack
    [0.6, seqColour(3)], // +0.2 → seq-4
    [0.8, seqColour(4)], // +0.6 → seq-5
    [1.0, seqColour(5)], // +1   → seq-6
  ] satisfies RampStop[];
}

/**
 * Given a normalised position t ∈ [0, 1] and a stop array, return the
 * interpolated (step-wise nearest) colour.
 *
 * This is STEP interpolation (nearest-stop), matching the discrete rendering
 * that HeatmapGrid cells use. The legend uses the same stops, so they match.
 */
export function colourAtPosition(t: number, stops: readonly RampStop[]): string {
  if (stops.length === 0) return 'transparent';
  let best = stops[0]!;
  for (const stop of stops) {
    if (t >= stop[0]) best = stop;
    else break;
  }
  return best[1];
}

/**
 * Map a raw value to a normalised ramp position.
 *
 * sequential: t = clamp((v - min) / (max - min), 0, 1)
 * diverging:  t = clamp((v / maxAbs + 1) / 2, 0, 1)  — 0 maps to 0.5
 */
export function normalisedPosition(
  v: number,
  options: { mode: 'sequential'; min: number; max: number } | { mode: 'diverging'; maxAbs: number },
): number {
  if (options.mode === 'sequential') {
    const span = Math.max(1e-6, options.max - options.min);
    return Math.max(0, Math.min(1, (v - options.min) / span));
  }
  // diverging
  const span = Math.max(1e-6, options.maxAbs);
  return Math.max(0, Math.min(1, (v / span + 1) / 2));
}

/**
 * Convenience: colour for a raw value given mode + domain.
 */
export function colourForValue(
  v: number,
  stops: readonly RampStop[],
  options: { mode: 'sequential'; min: number; max: number } | { mode: 'diverging'; maxAbs: number },
): string {
  return colourAtPosition(normalisedPosition(v, options), stops);
}
