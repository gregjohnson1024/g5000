/**
 * Process-wide live snapshot of the source-priority config.
 *
 * `subscribeSelected` needs the current `SourcePriorityConfig` on every sample.
 * The config lives in ConfigStore (@g5000/db) as an RxJS subject, but the
 * compute pipelines deep in @g5000/compute don't all hold a ConfigStore handle.
 * The g5000 app subscribes `ConfigStore.sourcePriority$` once at boot and pushes
 * the latest rules here via {@link setSharedSourcePriority}; any pipeline can
 * then read the live rules through {@link getSharedSourcePriority} and feed them
 * to `subscribeSelected` without plumbing ConfigStore through every layer.
 *
 * Unset → `[]`: no rules means `subscribeSelected` passes through
 * (last-write-wins), i.e. the original single-source behaviour. So wiring a
 * pipeline through this is safe before any rule exists.
 */
import type { SourcePriorityConfig } from './selector.js';

const GLOBAL_KEY = '__g5000_sourcePriority__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_sourcePriority__: SourcePriorityConfig | undefined;
}

/** Current source-priority rules, or `[]` if the app hasn't published any yet. */
export function getSharedSourcePriority(): SourcePriorityConfig {
  return globalThis[GLOBAL_KEY] ?? [];
}

export function setSharedSourcePriority(rules: SourcePriorityConfig): void {
  globalThis[GLOBAL_KEY] = rules;
}

export function _resetSharedSourcePriorityForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
