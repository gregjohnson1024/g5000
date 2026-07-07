/**
 * Checkbox — Tier-1 Field primitive.
 *
 * 24px custom checkbox. Token-only. No raw hex.
 * Also exports Radio for the same recipe in radio-button flavour.
 */

'use client';

import { useId } from 'react';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  caption?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  value?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  caption,
  disabled = false,
  className = '',
  name,
  value,
}: CheckboxProps): React.ReactElement {
  const id = useId();
  const captionId = useId();

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label
        htmlFor={id}
        className={[
          'flex items-center gap-3 cursor-pointer select-none text-body-sm',
          disabled ? 'opacity-50 cursor-not-allowed' : 'text-ink',
        ].join(' ')}
      >
        <div className="relative flex-shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            name={name}
            value={value}
            aria-describedby={caption ? captionId : undefined}
            className="sr-only"
          />
          {/* Custom checkbox visual */}
          <div
            className={[
              'w-6 h-6 rounded-[--r-control] border flex items-center justify-center transition-colors',
              checked
                ? 'bg-accent border-accent'
                : 'bg-surface-sunken border-hairline hover:border-hairline-strong',
            ].join(' ')}
            aria-hidden="true"
          >
            {checked && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <polyline
                  points="2,7 6,11 12,3"
                  stroke="var(--on-accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          {/* Focus ring */}
          <div
            className="absolute inset-0 rounded-[--r-control] pointer-events-none opacity-0 peer-focus-visible:opacity-100 ring-2 ring-[--focus] ring-offset-1 ring-offset-surface"
            aria-hidden="true"
          />
        </div>
        {label}
      </label>
      {caption && (
        <p id={captionId} className="ml-9 text-caption text-ink-3">
          {caption}
        </p>
      )}
    </div>
  );
}

export interface RadioProps {
  label: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  caption?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
}

export function Radio({
  label,
  value,
  checked,
  onChange,
  caption,
  disabled = false,
  className = '',
  name,
}: RadioProps): React.ReactElement {
  const id = useId();
  const captionId = useId();

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label
        htmlFor={id}
        className={[
          'flex items-center gap-3 cursor-pointer select-none text-body-sm',
          disabled ? 'opacity-50 cursor-not-allowed' : 'text-ink',
        ].join(' ')}
      >
        <div className="relative flex-shrink-0">
          <input
            id={id}
            type="radio"
            value={value}
            checked={checked}
            onChange={(e) => {
              if (e.target.checked) onChange(value);
            }}
            disabled={disabled}
            name={name}
            aria-describedby={caption ? captionId : undefined}
            className="sr-only"
          />
          {/* Custom radio visual */}
          <div
            className={[
              'w-6 h-6 rounded-full border flex items-center justify-center transition-colors',
              checked
                ? 'border-accent'
                : 'bg-surface-sunken border-hairline hover:border-hairline-strong',
            ].join(' ')}
            aria-hidden="true"
          >
            {checked && <div className="w-3 h-3 rounded-full bg-accent" aria-hidden="true" />}
          </div>
        </div>
        {label}
      </label>
      {caption && (
        <p id={captionId} className="ml-9 text-caption text-ink-3">
          {caption}
        </p>
      )}
    </div>
  );
}
