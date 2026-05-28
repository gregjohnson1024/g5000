const KN_TO_MS = 0.514444;

export interface PlanningSettings {
  stepMinutes?: number;
  pruneBucketDeg?: number;
  headingFanDeg?: number;
  headingResolutionDeg?: number;
  maxHours?: number;
  avoidLand?: boolean;
  autoMotor?: { minSailKt: number; motorKt: number };
}

export const PLANNING_DEFAULTS = {
  stepMinutes: 30,
  pruneBucketDeg: 2,
  headingFanDeg: 90,
  headingResolutionDeg: 5,
  maxHours: 168,
  avoidLand: true,
  autoMotor: { minSailKt: 0, motorKt: 5 },
} as const;

/** Plain numeric/boolean PlanOptions plus the m/s autoMotor the engine wants. */
export interface ResolvedPlanOptions {
  stepMinutes: number;
  pruneBucketDeg: number;
  headingFanDeg: number;
  headingResolutionDeg: number;
  maxHours: number;
  avoidLand: boolean;
  captureIsochrones: false;
  autoMotor?: { minSail: number; motor: number };
}

/** Merge engine defaults < settings.planning < per-request overrides. */
export function resolvePlanOptions(
  settings: PlanningSettings | undefined,
  request:
    | (Partial<Omit<ResolvedPlanOptions, 'autoMotor' | 'captureIsochrones'>> & {
        autoMotor?: { minSail: number; motor: number };
      })
    | undefined,
): ResolvedPlanOptions {
  const s = settings ?? {};
  const r = request ?? {};
  const pick = <K extends keyof typeof PLANNING_DEFAULTS>(k: K, rv: unknown): number | boolean =>
    (rv ?? s[k as keyof PlanningSettings] ?? PLANNING_DEFAULTS[k]) as number | boolean;

  const am = s.autoMotor ?? PLANNING_DEFAULTS.autoMotor;
  // minSailKt=0 means "never motor"; resolve to undefined so the planner skips
  // the motor path entirely rather than evaluating a threshold that never fires.
  const settingsAutoMotor =
    am.minSailKt > 0
      ? { minSail: am.minSailKt * KN_TO_MS, motor: am.motorKt * KN_TO_MS }
      : undefined;

  // When a request is present (the chart always sends one, seeded from these
  // settings), its autoMotor is authoritative — `undefined` means the user
  // explicitly turned auto-motor OFF, so it must NOT fall back to the settings
  // default. Only a bare call (no request at all) uses the settings default.
  const autoMotor = request === undefined ? settingsAutoMotor : r.autoMotor;

  return {
    stepMinutes: pick('stepMinutes', r.stepMinutes) as number,
    pruneBucketDeg: pick('pruneBucketDeg', r.pruneBucketDeg) as number,
    headingFanDeg: pick('headingFanDeg', r.headingFanDeg) as number,
    headingResolutionDeg: pick('headingResolutionDeg', r.headingResolutionDeg) as number,
    maxHours: pick('maxHours', r.maxHours) as number,
    avoidLand: pick('avoidLand', r.avoidLand) as boolean,
    captureIsochrones: false,
    autoMotor,
  };
}
