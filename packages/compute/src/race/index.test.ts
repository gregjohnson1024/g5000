import { describe, it, expect } from 'vitest';
import { Bus, createRaceState } from '@g5000/core';
import { startRaceComputePipeline } from './index.js';

describe('startRaceComputePipeline', () => {
  it('boots and disposes cleanly with no inputs', () => {
    const bus = new Bus();
    const rs = createRaceState();
    const polarRef = { current: null };
    const currRef = { current: null };
    const wpRef = { current: new Map() };
    const cogConcentrationRef = { current: 1 };
    const handle = startRaceComputePipeline(bus, rs, polarRef, currRef, wpRef, cogConcentrationRef);
    expect(handle.dispose).toBeTypeOf('function');
    handle.dispose();
  });
});
