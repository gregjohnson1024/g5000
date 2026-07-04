export interface DepthOffsets {
  keelBelowTransducerM?: number;
  transducerToWaterlineM?: number;
}
export interface Depths {
  sounderM: number;
  underKeelM: number | null;
  totalM: number | null;
}
export function deriveDepths(sounderM: number, o: DepthOffsets): Depths {
  return {
    sounderM,
    underKeelM: o.keelBelowTransducerM != null ? sounderM - o.keelBelowTransducerM : null,
    totalM: o.transducerToWaterlineM != null ? sounderM + o.transducerToWaterlineM : null,
  };
}
