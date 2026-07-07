/**
 * NumberField — Tier-1 Field primitive.
 *
 * Same recipe as TextField but numeric: 44px steppers (+/−) on either side.
 * Token-only. No raw hex.
 */

'use client';

import { useId } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  caption?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  required?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  unit,
  caption,
  error,
  disabled = false,
  className = '',
  name,
  required,
}: NumberFieldProps): React.ReactElement {
  const id = useId();
  const captionId = useId();
  const hasError = !!error;
  const captionText = error ?? caption;

  const decimals = precision ?? (step < 1 ? (String(step).split('.')[1]?.length ?? 1) : 0);

  const clamp = (v: number): number => {
    let clamped = v;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return parseFloat(clamped.toFixed(decimals));
  };

  const handleChange = (raw: string): void => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    onChange(clamp(n));
  };

  const decrement = () => onChange(clamp(value - step));
  const increment = () => onChange(clamp(value + step));

  const stepperClass =
    'flex-shrink-0 w-11 h-11 flex items-center justify-center ' +
    'bg-surface-raised border border-hairline rounded-[--r-control] ' +
    'text-ink-2 hover:text-ink hover:bg-surface hover:border-hairline-strong ' +
    'disabled:opacity-50 disabled:cursor-not-allowed ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] ' +
    'transition-colors text-body select-none';

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-label uppercase tracking-wider text-ink-2">
        {label}
        {unit && <span className="ml-1 font-normal text-ink-3 normal-case">({unit})</span>}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className="flex items-center gap-1.5">
        {/* Decrement */}
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || (min !== undefined && value <= min)}
          aria-label={`Decrease ${label}`}
          className={stepperClass}
        >
          −
        </button>
        {/* Input */}
        <input
          id={id}
          type="number"
          value={value.toFixed(decimals)}
          onChange={(e) => handleChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          name={name}
          required={required}
          aria-describedby={captionText ? captionId : undefined}
          aria-invalid={hasError ? true : undefined}
          className={[
            'flex-1 min-w-0 bg-surface-sunken border rounded-[--r-control]',
            'text-ink text-right tabular-nums font-mono',
            'px-3 h-11 text-body',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            'transition-colors',
            hasError ? 'border-danger' : 'border-hairline hover:border-hairline-strong',
          ].join(' ')}
        />
        {/* Increment */}
        <button
          type="button"
          onClick={increment}
          disabled={disabled || (max !== undefined && value >= max)}
          aria-label={`Increase ${label}`}
          className={stepperClass}
        >
          +
        </button>
      </div>
      {captionText && (
        <p id={captionId} className={`text-caption ${hasError ? 'text-danger' : 'text-ink-3'}`}>
          {captionText}
        </p>
      )}
    </div>
  );
}
