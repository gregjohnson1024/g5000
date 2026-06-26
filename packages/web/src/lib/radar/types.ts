export interface DecodedSpoke {
  angle: number;
  bearing?: number;
  range: number;
  time?: number;
  lat?: number;
  lon?: number;
  data: Uint8Array;
}

export interface LegendPixel {
  color: string;
  type: string;
}
export interface Legend {
  pixels: LegendPixel[];
  lowReturn?: number;
  mediumReturn?: number;
  strongReturn?: number;
  pixelColors?: number;
  historyStart?: number;
}
/** One entry of a radar's `controls` map (keyed by control id, e.g. `range`, `gain`). */
export interface RadarControlSpec {
  id?: number;
  name?: string;
  dataType?: string;
  minValue?: number;
  maxValue?: number;
  units?: string;
  /**
   * Values the control will accept. For `range` this is a SUBSET of the
   * radar's `supportedRanges` (the nm-derived steps only) — sending a
   * supportedRange that is not a validValue is rejected with HTTP 400.
   */
  validValues?: number[];
  descriptions?: Record<string, string>;
}

export interface Capabilities {
  spokesPerRevolution: number;
  maxSpokeLength: number;
  maxRange: number;
  minRange: number;
  supportedRanges: number[];
  legend: Legend;
  hasDoppler?: boolean;
  controls?: Record<string, RadarControlSpec>;
}
export interface RadarInfo {
  name: string;
  brand: string;
  model?: string;
  spokeDataUrl: string;
  streamUrl?: string;
  radarIpAddress?: string;
  replay?: boolean;
}
export interface ControlValue {
  value: number | string;
  auto?: boolean;
}
