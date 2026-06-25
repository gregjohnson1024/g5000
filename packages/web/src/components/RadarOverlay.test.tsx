/**
 * Light smoke test for RadarOverlay.
 *
 * NOTE: packages/web has no jsdom or @testing-library/react setup, so we
 * cannot mount the component and assert map.addSource/addLayer calls via
 * render(). The full "canvas source created" assertion belongs to the
 * emulator visual check (Task 10). Here we verify the module shape: the
 * named export exists and is a function.
 *
 * If jsdom + @testing-library/react are added to the workspace in future,
 * replace this with the render-based test from task-9-brief.md.
 */
import { describe, it, expect } from 'vitest';
import { RadarOverlay } from './RadarOverlay.js';

describe('RadarOverlay', () => {
  it('exports a function component', () => {
    expect(typeof RadarOverlay).toBe('function');
  });
});
