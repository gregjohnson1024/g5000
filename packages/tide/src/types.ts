export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TidalEvent {
  type: 'HW' | 'LW';
  /** Epoch milliseconds (UTC). */
  timeMs: number;
  /** Height in metres above Chart Datum. */
  heightM: number;
}

export type TideState = 'rising' | 'falling' | 'stand';
