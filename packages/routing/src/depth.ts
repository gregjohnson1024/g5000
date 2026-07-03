/**
 * Depth sampling interface for the draft constraint. Implementations live
 * outside this package (the web server loads a tiled ETOPO grid from disk);
 * the router only ever calls `depthAt`.
 */
export interface DepthField {
  /**
   * Water depth at a position in metres below datum (positive down).
   * `null` means unknown — no coverage or nodata at that point. The planner
   * treats unknown as passable (it never fabricates a depth), so a sparse
   * field degrades to "no constraint" rather than blocking open water.
   */
  depthAt(lat: number, lon: number): number | null;
}
