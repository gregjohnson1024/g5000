const M_PER_DEG_LAT = 111_320;

/** Square bbox of half-extent `rangeM` around (lat,lon). Order: TL, TR, BR, BL. */
export function rangeBboxCorners(
  lat: number,
  lon: number,
  rangeM: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  const dLat = rangeM / M_PER_DEG_LAT;
  const dLon = rangeM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat + dLat], // TL
    [lon + dLon, lat + dLat], // TR
    [lon + dLon, lat - dLat], // BR
    [lon - dLon, lat - dLat], // BL
  ];
}
