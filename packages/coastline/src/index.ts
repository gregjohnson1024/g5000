export type { CoastlinePolygon, Coastline, RBushEntry } from './types.js';
export {
  pointInRing,
  segmentsIntersect,
  segmentCrossesRing,
  ringAabb,
  type Point,
} from './geometry.js';
export { loadCoastlineFromGeojson } from './load.js';
export { isOnLand, intersectsLand } from './queries.js';
