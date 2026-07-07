/**
 * SelectField — Tier-1 Field primitive.
 *
 * Custom popover select (native selects retire). Keyboard-navigable.
 * Token-only. No raw hex.
 */

'use client';

import { useId, useRef, useState, useEffect, useCallback } from 'react';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps<V extends string = string> {
  label: string;
  value: V | null;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  caption?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  required?: boolean;
}

export function SelectField<V extends string = string>({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  caption,
  error,
  disabled = false,
  className = '',
  name,
  required,
}: SelectFieldProps<V>): React.ReactElement {
  const id = useId();
  const captionId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasError = !!error;
  const captionText = error ?? caption;

  const selectedOption = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
    setFocusedIdx(options.findIndex((o) => o.value === value));
  };

  const handleSelect = useCallback(
    (opt: SelectOption<V>) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setFocusedIdx(options.findIndex((o) => o.value === value));
      } else if (focusedIdx >= 0 && options[focusedIdx] && !options[focusedIdx]!.disabled) {
        handleSelect(options[focusedIdx]!);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(options.length - 1, i + 1));
      if (!open) setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(0, i - 1));
      if (!open) setOpen(true);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`} ref={containerRef}>
      <label htmlFor={id} className="text-label uppercase tracking-wider text-ink-2">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {/* Hidden native select for form semantics */}
      {name && (
        <select
          name={name}
          value={value ?? ''}
          onChange={() => {}}
          className="sr-only"
          tabIndex={-1}
          required={required}
          aria-hidden="true"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {/* Custom trigger */}
      <div className="relative">
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-describedby={captionText ? captionId : undefined}
          aria-invalid={hasError ? true : undefined}
          disabled={disabled}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className={[
            'w-full flex items-center justify-between gap-2',
            'bg-surface-sunken border rounded-[--r-control]',
            'text-left px-3 h-11 text-body',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors',
            hasError ? 'border-danger' : 'border-hairline hover:border-hairline-strong',
          ].join(' ')}
        >
          <span className={selectedOption ? 'text-ink' : 'text-ink-4'}>
            {selectedOption?.label ?? placeholder}
          </span>
          <span className="text-ink-3 pointer-events-none" aria-hidden="true">
            {open ? '▲' : '▼'}
          </span>
        </button>

        {/* Dropdown popover */}
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-50 w-full mt-1 bg-surface-raised border border-hairline-strong rounded-[--r-panel] shadow-xl overflow-auto max-h-60 py-1"
            style={{ boxShadow: '0 8px 24px rgb(0 0 0 / .55)' }}
          >
            {options.map((opt, i) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={value === opt.value}
                aria-disabled={opt.disabled}
                onClick={() => handleSelect(opt)}
                className={[
                  'px-3 py-2.5 text-body-sm cursor-pointer transition-colors',
                  opt.disabled ? 'text-ink-4 cursor-not-allowed' : 'text-ink hover:bg-surface',
                  value === opt.value ? 'text-accent-ink font-medium' : '',
                  i === focusedIdx ? 'bg-surface' : '',
                ].join(' ')}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {captionText && (
        <p id={captionId} className={`text-caption ${hasError ? 'text-danger' : 'text-ink-3'}`}>
          {captionText}
        </p>
      )}
    </div>
  );
}
