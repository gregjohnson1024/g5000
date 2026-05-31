import type { Bus } from '@g5000/core';
import type { ConfigStore, GrooveSettings } from '@g5000/db';
import { startGrooveComputePipeline, type GrooveSettingsRef } from '@g5000/compute/groove';

/**
 * Live groove metrics. Runs in every source mode (live/demo/replay) so replay
 * integration tests exercise the same path. Settings are read through a ref
 * that tracks ConfigStore, so a settings change applies on the next sample.
 */
export async function startGrooveSubsystem(deps: { bus: Bus; store: ConfigStore }): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const settingsRef: GrooveSettingsRef = { current: store.getGrooveSettings() };
  const sub = store.grooveSettings$.subscribe((s: GrooveSettings) => {
    settingsRef.current = s;
  });
  const handle = startGrooveComputePipeline(bus, settingsRef);
  // eslint-disable-next-line no-console
  console.log('[groove] live compute pipeline online');
  return async () => {
    handle.dispose();
    sub.unsubscribe();
  };
}
