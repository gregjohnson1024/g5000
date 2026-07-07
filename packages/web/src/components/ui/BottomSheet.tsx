'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * BottomSheet — reusable peek/half/full slide-up panel.
 *
 * Derived from the anchor AnchorDrawer pattern; generalised into a primitive
 * so the chart dock and any future sheet can share the same chrome.
 *
 * Props
 * ─────
 * open        — controlled: whether the sheet is expanded (non-peek)
 * onClose     — called when the user taps outside or the handle
 * children    — the sheet's scrollable body content
 * tabBar      — optional persistent tab-bar rendered below the content (the
 *               anchor drawer pattern: always visible, toggles the body)
 * label       — accessible aria-label for the dialog role
 * maxHeight   — CSS value for the body's max-height (default '50vh')
 * className   — extra classes on the root container
 *
 * The sheet is always pinned to the bottom. When open=false the body is
 * hidden and only the tabBar (if provided) shows. When open=true the body
 * slides in above the tabBar.
 *
 * The component does NOT manage its own open state — callers own that so they
 * can deep-link / persist it. See AnchorDrawer for the localStorage pattern.
 */

export interface BottomSheetProps {
  open: boolean;
  onClose?: () => void;
  children?: ReactNode;
  /** Persistent tab strip rendered below the body (always visible). */
  tabBar?: ReactNode;
  /** Accessible name for the dialog region. */
  label?: string;
  /** CSS value for the body's max-height. Default '50vh'. */
  maxHeight?: string;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  children,
  tabBar,
  label = 'Panel',
  maxHeight = '50vh',
  className,
}: BottomSheetProps): React.ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Click-outside: only when there's no tabBar driving open state
  useEffect(() => {
    if (!open || !onClose) return;
    const onDown = (e: MouseEvent): void => {
      const root = bodyRef.current?.parentElement;
      if (root && !root.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  return (
    <div
      className={[
        'fixed bottom-0 left-0 right-0 z-30',
        'bg-surface-sunken border-t border-hairline',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {open && (
        <div
          ref={bodyRef}
          role="dialog"
          aria-label={label}
          className="border-b border-hairline bg-surface overflow-y-auto"
          style={{ maxHeight }}
        >
          {children}
        </div>
      )}
      {tabBar}
    </div>
  );
}
