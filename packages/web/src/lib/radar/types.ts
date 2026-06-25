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
export interface Capabilities {
  spokesPerRevolution: number;
  maxSpokeLength: number;
  maxRange: number;
  minRange: number;
  supportedRanges: number[];
  legend: Legend;
  hasDoppler?: boolean;
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
