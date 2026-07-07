'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Physical Chipsee mast panel resolution: 1080 × 1920 px (portrait 9:16).
 * Source: docs/superpowers/specs/2026-05-31-helm-sub-groups-design.md
 * ("the portrait 1080×1920 panel is `/mast`")
 *
 * To adjust for a different panel: change these two constants only.
 */
const PANEL_W = 1080;
const PANEL_H = 1920;

/**
 * MastPreview — renders an iframe pointed at /mast, scaled down to fit a
 * preview box while preserving the panel's exact 9:16 portrait aspect ratio.
 *
 * The iframe is given the panel's native pixel dimensions (1080 × 1920) and
 * CSS-scaled to fill the available container width. Because /mast subscribes to
 * /api/mast/stream (SSE) independently, layout edits pushed via PUT /api/mast/layout
 * appear in the preview automatically — no extra wiring needed.
 */
export function MastPreview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const availW = el.clientWidth;
      setScale(availW / PANEL_W);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scaled height: once we know the scale factor, the container height = PANEL_H * scale.
  const previewH = scale > 0 ? Math.round(PANEL_H * scale) : 0;

  return (
    <section className="border border-slate-700 rounded-md p-4 space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-medium">Mast preview — live</div>
        <div className="text-xs text-slate-500">
          {PANEL_W}×{PANEL_H} px panel · updates automatically
        </div>
      </div>

      {/* Outer container stretches to available width; height follows the aspect ratio. */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: previewH > 0 ? previewH : undefined }}
        className="overflow-hidden rounded relative bg-black"
      >
        {scale > 0 && (
          <iframe
            src="/mast"
            title="Mast display preview"
            scrolling="no"
            style={{
              width: PANEL_W,
              height: PANEL_H,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      <p className="text-xs text-slate-500">
        Mirrors the physical Chipsee panel in real time. Save the layout above to see changes here
        instantly.
      </p>
    </section>
  );
}
