import { describe, expect, it } from 'vitest';
import { modelLayerView } from './model-layer.js';

describe('modelLayerView', () => {
  it('none → everything hidden, no wind model', () => {
    expect(modelLayerView('none')).toEqual({
      windHidden: true,
      currentHidden: true,
      isWindModel: false,
      isCurrent: false,
      windModel: null,
    });
  });
  it('gfs → wind shown, windModel gfs', () => {
    const v = modelLayerView('gfs');
    expect(v.windHidden).toBe(false);
    expect(v.currentHidden).toBe(true);
    expect(v.isWindModel).toBe(true);
    expect(v.isCurrent).toBe(false);
    expect(v.windModel).toBe('gfs');
  });
  it('ecmwf → wind shown, windModel ecmwf', () => {
    const v = modelLayerView('ecmwf');
    expect(v.windHidden).toBe(false);
    expect(v.windModel).toBe('ecmwf');
    expect(v.currentHidden).toBe(true);
  });
  it('cmems → current shown, no wind', () => {
    const v = modelLayerView('cmems');
    expect(v.windHidden).toBe(true);
    expect(v.currentHidden).toBe(false);
    expect(v.isCurrent).toBe(true);
    expect(v.isWindModel).toBe(false);
    expect(v.windModel).toBe(null);
  });
});
