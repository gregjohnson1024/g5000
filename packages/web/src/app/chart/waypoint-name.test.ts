import { describe, expect, it } from 'vitest';
import { nextWaypointName } from './waypoint-name';

describe('nextWaypointName', () => {
  it('starts at WP 1 for an empty list', () => {
    expect(nextWaypointName([])).toBe('WP 1');
  });
  it('increments past the highest existing WP n', () => {
    expect(nextWaypointName(['WP 1', 'WP 2'])).toBe('WP 3');
    expect(nextWaypointName(['WP 3', 'WP 1'])).toBe('WP 4');
  });
  it('ignores names that are not WP n', () => {
    expect(nextWaypointName(['Newport', 'Block Island'])).toBe('WP 1');
    expect(nextWaypointName(['Newport', 'WP 5', 'Fuel'])).toBe('WP 6');
  });
});
