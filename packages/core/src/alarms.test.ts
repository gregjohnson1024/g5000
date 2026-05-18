import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAlarmsRegistry,
  getSharedAlarms,
  setSharedAlarms,
  _resetAlarmsForTests,
  type AlarmsRegistry,
} from './alarms.js';

describe('AlarmsRegistry', () => {
  let registry: AlarmsRegistry;
  beforeEach(() => {
    _resetAlarmsForTests();
    registry = createAlarmsRegistry();
  });

  it('starts empty', () => {
    expect(registry.all()).toEqual([]);
    expect(registry.active()).toEqual([]);
  });

  it('fires an alarm and reports it as active', () => {
    registry.fire({ id: 'shallow-water', severity: 'CRITICAL', label: 'Shallow Water', sticky: false });
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('shallow-water');
    expect(active[0]?.firedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(active[0]?.clearedAt).toBeNull();
    expect(active[0]?.ackedAt).toBeNull();
  });

  it('non-sticky alarms drop out of active when cleared', () => {
    registry.fire({ id: 'shallow-water', severity: 'CRITICAL', label: 'Shallow Water', sticky: false });
    registry.clear('shallow-water');
    expect(registry.active()).toHaveLength(0);
    const all = registry.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.clearedAt).not.toBeNull();
  });

  it('sticky alarms remain active even after clear', () => {
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    registry.clear('mob');
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.clearedAt).not.toBeNull();
  });

  it('ack removes alarm from active list (sticky or not)', () => {
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    registry.ack('mob');
    expect(registry.active()).toHaveLength(0);
    expect(registry.all()[0]?.ackedAt).not.toBeNull();
  });

  it('dedupes repeated fire calls for the same id (no duplicate active entries)', () => {
    registry.fire({ id: 'over-speed', severity: 'WARN', label: 'Over Speed', sticky: false });
    registry.fire({ id: 'over-speed', severity: 'WARN', label: 'Over Speed', sticky: false });
    expect(registry.active()).toHaveLength(1);
  });

  it('shares state via globalThis accessors', () => {
    setSharedAlarms(registry);
    expect(getSharedAlarms()).toBe(registry);
  });
});
