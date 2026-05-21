export interface OffscreenAnchor {
  /** Pixel x of the pill anchor, in viewport coordinates. */
  x: number;
  /** Pixel y of the pill anchor, in viewport coordinates. */
  y: number;
  /**
   * Screen-space bearing from viewport center to the boat, in degrees.
   * 0 = boat directly above; 90 = boat to the right; 180 = below; 270 = left.
   */
  bearingDeg: number;
}

/**
 * Given the boat's projected pixel position (which may be outside the
 * viewport), the viewport size, and a padding inset for the pill, return
 * the on-edge anchor point closest to the boat plus the screen-space
 * bearing to the boat from the viewport center. Returns null when the
 * boat is inside the viewport — caller should hide the indicator.
 */
export function computeOffscreenAnchor(args: {
  projected: { x: number; y: number };
  viewport: { width: number; height: number };
  pad: number;
}): OffscreenAnchor | null {
  const { projected, viewport, pad } = args;
  const { x, y } = projected;
  const { width, height } = viewport;
  const inside = x >= 0 && x <= width && y >= 0 && y <= height;
  if (inside) return null;
  const clampedX = Math.min(Math.max(x, pad), width - pad);
  const clampedY = Math.min(Math.max(y, pad), height - pad);
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  // atan2(dx, -dy) puts 0° at "up" and increases clockwise.
  const rad = Math.atan2(dx, -dy);
  const bearingDeg = ((rad * 180) / Math.PI + 360) % 360;
  return { x: clampedX, y: clampedY, bearingDeg };
}
