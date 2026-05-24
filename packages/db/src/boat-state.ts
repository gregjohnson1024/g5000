/** Persisted live boat state surfaced + controlled by the annotation box. */
export interface BoatState {
  /** Daggerboard position as percent down: 0 = fully up, 100 = fully down. */
  daggerboards: { port: number; starboard: number };
  /** Engine run state per side (rpm deferred). */
  engines: { port: { running: boolean }; starboard: { running: boolean } };
}

export const DEFAULT_BOAT_STATE: BoatState = {
  daggerboards: { port: 0, starboard: 0 },
  engines: { port: { running: false }, starboard: { running: false } },
};
