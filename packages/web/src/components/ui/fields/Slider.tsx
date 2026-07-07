/**
 * Slider — Tier-1 Field primitive.
 *
 * Retires .fc-slider hex skin. Styled entirely via CSS custom properties so
 * it re-themes with data-theme. Same field recipe: label above, caption/error below.
 * Token-only. No raw hex.
 */

'use client';

import { useId } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  /** Show the current value next to the label */
  showValue?: boolean;
  valueFmt?: (v: number) => string;
  caption?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  precision,
  unit,
  showValue = true,
  valueFmt,
  caption,
  error,
  disabled = false,
  className = '',
  name,
}: SliderProps): React.ReactElement {
  const id = useId();
  const captionId = useId();
  const hasError = !!error;
  const captionText = error ?? caption;

  const decimals = precision ?? (step < 1 ? (String(step).split('.')[1]?.length ?? 1) : 0);
  const formatted = valueFmt
    ? valueFmt(value)
    : `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-label uppercase tracking-wider text-ink-2">
          {label}
          {unit && <span className="ml-1 font-normal text-ink-3 normal-case">({unit})</span>}
        </label>
        {showValue && (
          <span className="text-body-sm font-mono tabular-nums text-ink">{formatted}</span>
        )}
      </div>

      {/* Range input — styled via global CSS (slider track + thumb tokens in globals.css) */}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        name={name}
        aria-describedby={captionText ? captionId : undefined}
        aria-invalid={hasError ? true : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatted}
        className={[
          'w-full h-2 appearance-none cursor-pointer',
          'rounded-full bg-surface-raised',
          '[&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
          '[&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:bg-accent',
          '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface',
          '[&::-webkit-slider-thumb]:shadow-sm',
          '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5',
          '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0',
          '[&::-moz-range-thumb]:bg-accent',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          hasError ? 'accent-danger' : 'accent-[--accent]',
        ].join(' ')}
      />

      {captionText && (
        <p id={captionId} className={`text-caption ${hasError ? 'text-danger' : 'text-ink-3'}`}>
          {captionText}
        </p>
      )}
    </div>
  );
}
