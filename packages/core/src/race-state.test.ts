import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRaceState,
  defaultRaceStateConfig,
  setSharedRaceState,
  getSharedRaceState,
  _resetSharedRaceStateForTests,
  type RaceStateConfig,
} from './race-state.js';

describe('RaceState', () => {
  beforeEach(() => _resetSharedRaceStateForTests());

  it('starts with default config: idle timer, no line, no mark', () => {
    const rs = createRaceState();
    expect(rs.get().timer.state).toBe('idle');
    expect(rs.get().timer.startMs).toBeNull();
    expect(rs.get().line.port).toBeUndefined();
    expect(rs.get().line.stbd).toBeUndefined();
    expect(rs.get().activeMarkWaypointId).toBeUndefined();
    expect(rs.get().settings.shiftThresholdDeg).toBe(7);
  });

  it('mutate() applies an updater and notifies subscribers', () => {
    const rs = createRaceState();
    const seen: RaceStateConfig[] = [];
    const off = rs.subscribe((next) => seen.push(next));
    rs.mutate((draft) => {
      draft.timer.startMs = 1234;
      draft.timer.state = 'pre-start';
    });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.timer.startMs).toBe(1234);
    expect(seen[0]!.timer.state).toBe('pre-start');
    expect(rs.get().timer.startMs).toBe(1234);
  });

  it('hydrate() replaces config wholesale and notifies once', () => {
    const rs = createRaceState();
    const seen: RaceStateConfig[] = [];
    const off = rs.subscribe((next) => seen.push(next));
    rs.hydrate({
      ...defaultRaceStateConfig(),
      timer: { state: 'started', startMs: 999 },
      activeMarkWaypointId: 'wp-1',
    });
    off();
    expect(seen).toHaveLength(1);
    expect(rs.get().timer.state).toBe('started');
    expect(rs.get().activeMarkWaypointId).toBe('wp-1');
  });

  it('shared singleton: set then get returns the same instance', () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    expect(getSharedRaceState()).toBe(rs);
  });

  it('getSharedRaceState() returns null when unset', () => {
    expect(getSharedRaceState()).toBeNull();
  });

  it('defaultRaceStateConfig() returns fresh copies (no shared refs)', () => {
    const a = defaultRaceStateConfig();
    const b = defaultRaceStateConfig();
    expect(a).not.toBe(b);
    expect(a.line).not.toBe(b.line);
    expect(a.settings).not.toBe(b.settings);
  });
});
