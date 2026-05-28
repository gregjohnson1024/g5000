/** The single mutually-exclusive chart model overlay selection. */
export type ChartModel = 'none' | 'gfs' | 'ecmwf' | 'hrrr' | 'cmems';

export interface ModelLayerView {
  /** WindOverlay hidden unless a wind model (gfs/ecmwf/hrrr) is selected. */
  windHidden: boolean;
  /** CurrentOverlay hidden unless CMEMS is selected. */
  currentHidden: boolean;
  /** True when gfs/ecmwf/hrrr — gates the forecast timeline + manifest poll. */
  isWindModel: boolean;
  /** True when cmems — gates the Refresh CMEMS button. */
  isCurrent: boolean;
  /** The wind-model param for WindOverlay when active, else null. */
  windModel: 'gfs' | 'ecmwf' | 'hrrr' | null;
}

export function modelLayerView(model: ChartModel): ModelLayerView {
  const isWindModel = model === 'gfs' || model === 'ecmwf' || model === 'hrrr';
  const isCurrent = model === 'cmems';
  return {
    windHidden: !isWindModel,
    currentHidden: !isCurrent,
    isWindModel,
    isCurrent,
    windModel: isWindModel ? model : null,
  };
}
