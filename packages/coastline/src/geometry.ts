export type Point = [number, number]; // [lon, lat]

/**
 * Ray-casting point-in-polygon. Returns true if `p` is strictly inside the
 * closed ring `ring` (first == last). Edge cases: points on the boundary
 * are considered outside (deterministic and good enough for routing's
 * land-avoidance use case — start/end points are checked with a small
 * inland buffer separately if needed).
 */
export function pointInRing(p: Point, ring: Point[]): boolean {
  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 2D segment-segment intersection. Treats collinear-overlap as intersection.
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = sign(cross(sub(b2, b1), sub(a1, b1)));
  const d2 = sign(cross(sub(b2, b1), sub(a2, b1)));
  const d3 = sign(cross(sub(a2, a1), sub(b1, a1)));
  const d4 = sign(cross(sub(a2, a1), sub(b2, a1)));
  if (d1 !== d2 && d3 !== d4) return true;
  // Collinear cases (endpoints touching)
  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;
  return false;
}

export function segmentCrossesRing(a: Point, b: Point, ring: Point[]): boolean {
  // Cheap bbox prefilter
  const ringBbox = ringAabb(ring);
  const segBbox: [number, number, number, number] = [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
  if (!bboxOverlap(ringBbox, segBbox)) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    if (segmentsIntersect(a, b, ring[i]!, ring[i + 1]!)) return true;
  }
  // Endpoint may be inside even if no edge crosses (segment fully inside)
  if (pointInRing(a, ring) || pointInRing(b, ring)) return true;
  return false;
}

export function ringAabb(ring: Point[]): [number, number, number, number] {
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return [xmin, ymin, xmax, ymax];
}

function bboxOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}
function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}
function sign(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}
