/**
 * TextField — Tier-1 Field primitive.
 *
 * One recipe: sunken well, --hairline border, r-control, 44px, focus ring.
 * Label voice above, caption hint below, danger-colored error caption.
 *
 * Token-only. No raw hex.
 */

'use client';

import { useId } from 'react';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  caption?: string;
  error?: string;
  disabled?: boolean;
  /** If true, renders a <textarea> instead of <input> */
  multiline?: boolean;
  rows?: number;
  className?: string;
  inputClassName?: string;
  /** HTML input type (default 'text') */
  type?: 'text' | 'email' | 'url' | 'tel' | 'search' | 'password';
  autoComplete?: string;
  name?: string;
  required?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  caption,
  error,
  disabled = false,
  multiline = false,
  rows = 3,
  className = '',
  inputClassName = '',
  type = 'text',
  autoComplete,
  name,
  required,
}: TextFieldProps): React.ReactElement {
  const id = useId();
  const captionId = useId();
  const hasError = !!error;
  const captionText = error ?? caption;

  const baseInputClasses = [
    'w-full bg-surface-sunken border rounded-[--r-control]',
    'text-ink placeholder:text-ink-4',
    'px-3 h-11 text-body',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'transition-colors',
    hasError
      ? 'border-danger'
      : 'border-hairline hover:border-hairline-strong focus:border-hairline-strong',
    inputClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-label uppercase tracking-wider text-ink-2">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          name={name}
          required={required}
          aria-describedby={captionText ? captionId : undefined}
          aria-invalid={hasError ? true : undefined}
          className={`${baseInputClasses} h-auto py-2.5 resize-y`}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          name={name}
          required={required}
          autoComplete={autoComplete}
          aria-describedby={captionText ? captionId : undefined}
          aria-invalid={hasError ? true : undefined}
          className={baseInputClasses}
        />
      )}
      {captionText && (
        <p id={captionId} className={`text-caption ${hasError ? 'text-danger' : 'text-ink-3'}`}>
          {captionText}
        </p>
      )}
    </div>
  );
}
