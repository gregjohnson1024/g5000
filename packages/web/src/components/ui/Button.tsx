import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Button — token-only, four variants, two sizes.
 *
 * Variants:
 *   primary   — accent fill (amber background), on-accent text
 *   secondary — hairline-strong outline, ink text
 *   ghost     — no border/bg; ink text; hover shows surface-raised bg
 *   danger    — danger-strong fill, light text (for destructive actions)
 *
 * Sizes:
 *   md — min-height 44px (glance-safe; use everywhere)
 *   sm — min-height 36px (work surfaces + pointer:fine only)
 *
 * Focus ring: 2px, focus-visible only, --focus color.
 * Radius: --r-control via [border-radius:var(--r-control)].
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent border border-accent hover:bg-accent-hi active:bg-accent-strong',
  secondary:
    'bg-transparent text-ink border border-hairline-strong hover:bg-surface-raised active:bg-surface-raised',
  ghost:
    'bg-transparent text-ink border border-transparent hover:bg-surface-raised active:bg-surface-raised',
  danger:
    'bg-danger-strong text-ink-value border border-danger-strong hover:opacity-90 active:opacity-80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-[44px] px-4 py-2 text-[0.833rem]',
  sm: 'min-h-[36px] px-3 py-1.5 text-[0.833rem]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center gap-2',
        'font-semibold leading-none',
        'transition-colors duration-150',
        '[border-radius:var(--r-control)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * IconButton — 44px square hit target wrapping a Lucide icon.
 *
 * The visual icon is typically 20–24px; the hit target is always 44px.
 * Pass `aria-label` — it is required for accessibility.
 * Variants: primary / secondary / ghost / danger (same tokens as Button).
 * Tokens only.
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Required for accessibility. */
  'aria-label': string;
  children: ReactNode;
}

export function IconButton({
  variant = 'ghost',
  className,
  children,
  ...rest
}: IconButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center',
        'size-[44px] flex-shrink-0',
        'transition-colors duration-150',
        '[border-radius:var(--r-control)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
