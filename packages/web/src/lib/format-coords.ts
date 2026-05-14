/**
 * Marine-style lat/lon formatting in degrees, decimal-minutes (DMM):
 *   33° 25.273' N
 *   66° 21.636' W
 *
 * DMM is the standard plotter / GPS / Notice-to-Mariners format. Decimal
 * degrees and DMS are also valid but harder to read off the helm at speed.
 */

export interface DmmParts {
  deg: number;
  min: string;
  hemi: 'N' | 'S' | 'E' | 'W';
}

function dmm(value: number, posHemi: 'N' | 'E', negHemi: 'S' | 'W'): DmmParts {
  const hemi: 'N' | 'S' | 'E' | 'W' = value >= 0 ? posHemi : negHemi;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(3);
  return { deg, min, hemi };
}

export function fmtLatDmm(lat: number): DmmParts {
  return dmm(lat, 'N', 'S');
}

export function fmtLonDmm(lon: number): DmmParts {
  return dmm(lon, 'E', 'W');
}

export function fmtLatLonDmm(lat: number, lon: number): string {
  const a = fmtLatDmm(lat);
  const b = fmtLonDmm(lon);
  // Compact marine format: `33 42.232n 66 25.240w` — no degree/prime
  // symbols (easier to read in monospace columns and to type back),
  // lowercase hemispheres, single space between coords.
  return `${a.deg} ${a.min}${a.hemi.toLowerCase()} ${b.deg} ${b.min}${b.hemi.toLowerCase()}`;
}
