export interface Bbox {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

const MAX_SPAN_DEG = 5;

export function parseBbox(raw: string | null | undefined): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (p.trim() === '' ? NaN : Number(p)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [lonMin, latMin, lonMax, latMax] = nums as [number, number, number, number];
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) return null;
  if (lonMin >= lonMax || latMin >= latMax) return null;
  if (lonMax - lonMin > MAX_SPAN_DEG || latMax - latMin > MAX_SPAN_DEG) return null;
  return { lonMin, latMin, lonMax, latMax };
}

export function quantizeBbox(b: Bbox): Bbox {
  return {
    lonMin: Math.floor(b.lonMin * 10) / 10,
    latMin: Math.floor(b.latMin * 10) / 10,
    lonMax: Math.ceil(b.lonMax * 10) / 10,
    latMax: Math.ceil(b.latMax * 10) / 10,
  };
}

export function bboxKey(b: Bbox): string {
  return `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
}
