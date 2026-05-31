import type { FormattedTile } from './format';

const COLOR_VAR: Record<FormattedTile['color'], string> = {
  green: 'var(--mast-green)',
  amber: 'var(--mast-amber)',
  red: 'var(--mast-red)',
  default: 'var(--mast-fg)',
};

export function Tile({ label, units, fmt }: { label: string; units: string; fmt: FormattedTile }) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="text-[2vh] uppercase tracking-widest" style={{ color: 'var(--mast-muted)' }}>
        {label}
      </div>
      <div
        className={`mast-tile-value font-bold leading-none text-[16vh] tabular-nums${fmt.stale ? ' mast-stale' : ''}`}
        style={{ color: fmt.stale ? undefined : COLOR_VAR[fmt.color] }}
      >
        {fmt.text}
      </div>
      <div className="text-[2.5vh]" style={{ color: 'var(--mast-muted)' }}>
        {units}
      </div>
    </div>
  );
}
