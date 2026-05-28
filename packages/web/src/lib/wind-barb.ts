const M_PER_DEG_LAT = 111_320;

export function projectGeo(
  fromLat: number,
  fromLon: number,
  meters: number,
  bearingRad: number,
): [number, number] {
  const dN = meters * Math.cos(bearingRad);
  const dE = meters * Math.sin(bearingRad);
  const dLat = dN / M_PER_DEG_LAT;
  const dLon = dE / (M_PER_DEG_LAT * Math.cos((fromLat * Math.PI) / 180));
  return [fromLon + dLon, fromLat + dLat];
}

/**
 * Build GeoJSON features for a single wind barb at (lat, lon).
 * Standard met convention: shaft points INTO the wind (open end = wind source).
 * Barbs on the left side of the shaft when facing the wind source.
 *
 * @param windFromBearingRad  Direction the wind is coming FROM (radians true)
 * @param shaftLenM           Shaft length in metres (controls visual scale)
 */
export function makeBarb(
  lat: number,
  lon: number,
  speedKn: number,
  windFromBearingRad: number,
  shaftLenM: number,
): GeoJSON.Feature[] {
  if (speedKn < 2.5) {
    const tinyTip = projectGeo(lat, lon, 50, 0);
    return [
      {
        type: 'Feature',
        properties: { kind: 'shaft' },
        geometry: { type: 'LineString', coordinates: [[lon, lat], tinyTip] },
      },
    ];
  }
  const shaftEnd = projectGeo(lat, lon, shaftLenM, windFromBearingRad);
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { kind: 'shaft' },
      geometry: { type: 'LineString', coordinates: [[lon, lat], shaftEnd] },
    },
  ];

  const rounded = Math.round(speedKn / 5) * 5;
  const pennants = Math.floor(rounded / 50);
  const fulls = Math.floor((rounded - pennants * 50) / 10);
  const halfs = Math.floor((rounded - pennants * 50 - fulls * 10) / 5);

  const perpBearing = windFromBearingRad - Math.PI / 2;
  const fullLen = shaftLenM * 0.45;
  const halfLen = shaftLenM * 0.25;
  const pennantLen = shaftLenM * 0.45;
  const stepM = shaftLenM * 0.18;
  let distFromGrid = shaftLenM;

  for (let i = 0; i < pennants; i++) {
    const base = projectGeo(lat, lon, distFromGrid, windFromBearingRad);
    const inner = projectGeo(lat, lon, distFromGrid - stepM, windFromBearingRad);
    const tip = projectGeo(base[1], base[0], pennantLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'pennant' },
      geometry: { type: 'Polygon', coordinates: [[base, tip, inner, base]] },
    });
    distFromGrid -= stepM;
  }
  for (let i = 0; i < fulls; i++) {
    const base = projectGeo(lat, lon, distFromGrid, windFromBearingRad);
    const tip = projectGeo(base[1], base[0], fullLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'barb' },
      geometry: { type: 'LineString', coordinates: [base, tip] },
    });
    distFromGrid -= stepM;
  }
  if (halfs > 0) {
    if (fulls === 0 && pennants === 0) distFromGrid -= stepM;
    const base = projectGeo(lat, lon, distFromGrid, windFromBearingRad);
    const tip = projectGeo(base[1], base[0], halfLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'barb' },
      geometry: { type: 'LineString', coordinates: [base, tip] },
    });
  }
  return features;
}
