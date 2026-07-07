import { statusChipClasses, type StatusChipKind } from './status-chip-kind';

export type { StatusChipKind };

/**
 * StatusChip — tinted bg/20 + border + ink recipe.
 *
 * Extracted from StatusBadge's VISUAL recipe. The /api/wardrobe/active poll
 * stays in StatusBadge; this primitive is a pure presentation component.
 *
 * Kinds: ok / warn / alarm / info / neutral / live(pulse) / stale(age) /
 *        demo / replay / armed(pulse)
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 * Radius: r-badge (pill) via [border-radius:var(--r-badge)].
 */
export function StatusChip({
  kind,
  label,
  className,
}: {
  kind: StatusChipKind;
  label: string;
  className?: string;
}): React.ReactElement {
  const { wrapper, pulse } = statusChipClasses(kind);

  return (
    <span
      className={[
        'inline-flex items-center gap-1',
        'px-2 py-0.5',
        'text-[0.722rem] font-medium leading-none',
        'border',
        '[border-radius:var(--r-badge)]',
        wrapper,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full bg-current animate-pulse"
        />
      )}
      {label}
    </span>
  );
}
