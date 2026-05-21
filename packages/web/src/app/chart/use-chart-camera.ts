'use client';

export type Orientation = 'north' | 'course' | 'heading';

export function cycleOrientation(o: Orientation): Orientation {
  if (o === 'north') return 'course';
  if (o === 'course') return 'heading';
  return 'north';
}

/**
 * Smallest absolute angular delta between two bearings in degrees, wrapping
 * across the 0/360 seam. Always non-negative, always ≤ 180.
 */
export function wrapBearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function readFollowFromStorage(raw: string | null): boolean {
  if (raw === null) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === true || parsed === false ? parsed : true;
  } catch {
    return true;
  }
}

export function readOrientationFromStorage(raw: string | null): Orientation {
  if (raw === 'north' || raw === 'course' || raw === 'heading') return raw;
  return 'north';
}
