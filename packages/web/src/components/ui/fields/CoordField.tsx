/**
 * CoordField — Tier-1 Field primitive.
 *
 * Coordinate input that lifts lib/coords parser verbatim. Accepts any common
 * format (DMS, DMM, decimal, signed) and displays in the canonical compact
 * marine DMM format `33 42.232n 66 25.240w` after a successful parse.
 *
 * Token-only. No raw hex.
 */

'use client';

import { useId, useState } from 'react';
import { parseLatLon, fmtLatLonDmm } from '../../../lib/coords';

export interface CoordFieldProps {
  label: string;
  /** Current lat/lon value in decimal degrees */
  value: { lat: number; lon: number } | null;
  onChange: (value: { lat: number; lon: number }) => void;
  caption?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
}

export function CoordField({
  label,
  value,
  onChange,
  caption,
  error: externalError,
  disabled = false,
  className = '',
  name,
  required,
  placeholder = '33 42.232n 66 25.240w',
}: CoordFieldProps): React.ReactElement {
  const id = useId();
  const captionId = useId();

  // Draft tracks what the user types (before parse commits)
  const [draft, setDraft] = useState<string>(
    value !== null ? fmtLatLonDmm(value.lat, value.lon) : '',
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const hasError = !!externalError || !!parseError;
  const captionText = externalError ?? parseError ?? caption;

  const handleChange = (raw: string): void => {
    setDraft(raw);
    setParseError(null);
    if (raw.trim() === '') return;
    try {
      const { lat, lon } = parseLatLon(raw);
      onChange({ lat, lon });
    } catch {
      // Don't commit on invalid input — wait for blur
    }
  };

  const handleBlur = (): void => {
    if (draft.trim() === '') {
      setParseError(null);
      return;
    }
    try {
      const { lat, lon } = parseLatLon(draft);
      setParseError(null);
      // Normalise display to compact DMM
      setDraft(fmtLatLonDmm(lat, lon));
      onChange({ lat, lon });
    } catch (e) {
      setParseError(`Cannot parse "${draft.trim().slice(0, 30)}" — use DMM: 33 42.232n 66 25.240w`);
    }
  };

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
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        name={name}
        required={required}
        aria-describedby={captionText ? captionId : undefined}
        aria-invalid={hasError ? true : undefined}
        className={[
          'w-full bg-surface-sunken border rounded-[--r-control]',
          'text-ink placeholder:text-ink-4 font-mono tabular-nums',
          'px-3 h-11 text-body',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
          hasError ? 'border-danger' : 'border-hairline hover:border-hairline-strong',
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
