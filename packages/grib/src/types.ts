/**
 * Geographic point in degrees. `lat` is [-90, 90], `lon` is [-180, 180].
 */
export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Bounding box in degrees. Crosses the dateline if `lonMin > lonMax`.
 */
export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Time-varying 2D wind field on a regular lat/lon grid.
 *
 * Arrays are stored ascending: `lats[0] < lats[1] < ...`, same for `lons`,
 * same for `times` (unix seconds). `u[t][lat][lon]` is the eastward
 * 10-m wind component in m/s; `v` is the northward component in m/s.
 *
 * Indexing follows the natural meteorology convention: `u > 0` = wind
 * blowing eastward, `v > 0` = wind blowing northward.
 */
export interface WindField {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'GFS' | 'ECMWF';
  /** Unix seconds when the model run was issued (the "00z" / "12z" run start). */
  runTime: number;
}

/**
 * Same shape as `WindField`, but `u` and `v` are sea-surface current m/s.
 * Convention: `u > 0` = current flowing eastward, `v > 0` = northward.
 */
export interface CurrentField {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'RTOFS';
  runTime: number;
}
