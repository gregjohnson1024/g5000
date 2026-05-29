import { Fragment } from 'react';
import type { AisTarget } from '@g5000/core';
import type { CpaResult } from '@g5000/compute';
import { aisDetailRows, fmtTcpa } from '../../lib/ais-detail';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../lib/units';

const NM = 1852;

// Sort state for the targets table. Threats always float to the top
// regardless of sort selection (safety invariant); within the threat
// group and the non-threat group, rows order by `sortKey` in `sortDir`.
export type SortKey = 'mmsi' | 'name' | 'length' | 'sog' | 'cog' | 'range' | 'cpa' | 'tcpa';

interface TargetWithCpa {
  target: AisTarget;
  cpa: CpaResult | null;
  stale: boolean;
}

interface TargetsTableProps {
  targetsWithCpa: TargetWithCpa[];
  selectedRow: TargetWithCpa | null | undefined;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  handleSort: (k: SortKey) => void;
  selectedMmsi: number | null;
  setSelectedMmsi: (mmsi: number | null) => void;
  isThreat: (cpa: CpaResult | null) => boolean;
  rangeNm: number;
  mutes: Record<number, number>;
  muteVessel: (mmsi: number) => void;
  unmuteVessel: (mmsi: number) => void;
}

export function TargetsTable({
  targetsWithCpa,
  selectedRow,
  sortKey,
  sortDir,
  handleSort,
  selectedMmsi,
  setSelectedMmsi,
  isThreat,
  rangeNm,
  mutes,
  muteVessel,
  unmuteVessel,
}: TargetsTableProps) {
  return (
    <div className="flex-1 min-w-[320px]">
      <h2 className="font-semibold mb-2 text-slate-300">Targets ({targetsWithCpa.length})</h2>
      {selectedRow && (
        <div className="mb-3 bg-slate-900 border border-slate-800 rounded p-3 text-xs font-mono">
          <div className="text-slate-400 mb-1 text-[10px] uppercase">Selected</div>
          <div className="grid grid-cols-2 gap-y-1">
            {aisDetailRows(selectedRow.target, selectedRow.cpa).map(([label, value]) => (
              <Fragment key={label}>
                <div className="text-slate-400">{label}</div>
                <div>{value}</div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-slate-400 border-b border-slate-800">
            {(
              [
                { k: 'mmsi', label: 'MMSI', align: 'left' },
                { k: 'name', label: 'Name', align: 'left' },
                { k: 'length', label: 'LOA', align: 'right' },
                { k: 'sog', label: 'SOG', align: 'right' },
                { k: 'cog', label: 'COG', align: 'right' },
                { k: 'range', label: 'Range', align: 'right' },
                { k: 'cpa', label: 'CPA', align: 'right' },
                { k: 'tcpa', label: 'TCPA', align: 'right' },
              ] as { k: SortKey; label: string; align: 'left' | 'right' }[]
            ).map(({ k, label, align }) => {
              const active = sortKey === k;
              const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
              return (
                <th
                  key={k}
                  className={`py-1 ${align === 'left' ? 'text-left' : 'text-right'} cursor-pointer select-none hover:text-slate-200 ${active ? 'text-slate-200' : ''}`}
                  onClick={() => handleSort(k)}
                  title={`Sort by ${label}`}
                >
                  {label}
                  {arrow && <span className="ml-1 text-[10px]">{arrow}</span>}
                </th>
              );
            })}
            <th className="text-right py-1">Mute</th>
          </tr>
        </thead>
        <tbody>
          {targetsWithCpa
            .filter(({ cpa }) => cpa && cpa.rangeMeters < rangeNm * NM * 2)
            .sort((a, b) => {
              // Safety invariant: threats always float to the top of the
              // list regardless of column-sort choice. Stale-position CPA
              // doesn't count as a threat (last fix is too old to act on).
              const ta = !a.stale && isThreat(a.cpa) ? 0 : 1;
              const tb = !b.stale && isThreat(b.cpa) ? 0 : 1;
              if (ta !== tb) return ta - tb;
              // Within the threat / non-threat groups, sort by the
              // selected column. Missing values sort to the bottom of
              // whichever direction is active so they don't dominate.
              const valueOf = (r: typeof a): number | string | null => {
                switch (sortKey) {
                  case 'mmsi':
                    return r.target.mmsi;
                  case 'name':
                    return r.target.name ?? null;
                  case 'length':
                    return r.target.length ?? null;
                  case 'sog':
                    return r.target.sog ?? null;
                  case 'cog':
                    return r.target.cog ?? null;
                  case 'range':
                    return r.cpa?.rangeMeters ?? null;
                  case 'cpa':
                    return r.cpa?.cpaMeters ?? null;
                  case 'tcpa':
                    return r.cpa?.tcpaSeconds ?? null;
                }
              };
              const av = valueOf(a);
              const bv = valueOf(b);
              if (av === null && bv === null) return 0;
              if (av === null) return 1;
              if (bv === null) return -1;
              const raw =
                typeof av === 'string' && typeof bv === 'string'
                  ? av.localeCompare(bv)
                  : (av as number) - (bv as number);
              return sortDir === 'asc' ? raw : -raw;
            })
            .map(({ target, cpa, stale }) => {
              const threat = !stale && isThreat(cpa);
              const selected = selectedMmsi === target.mmsi;
              const mutedAt = mutes[target.mmsi];
              const muted = mutedAt !== undefined;
              const remutedTriggerNm = muted ? (mutedAt * 0.9) / NM : null;
              const rowClass = stale
                ? 'text-slate-500 italic'
                : muted
                  ? 'text-slate-500'
                  : threat
                    ? 'text-red-300'
                    : '';
              return (
                <tr
                  key={target.mmsi}
                  className={`border-b border-slate-900 cursor-pointer hover:bg-slate-900 ${
                    selected ? 'bg-slate-800' : ''
                  } ${rowClass}`}
                  onClick={() => setSelectedMmsi(target.mmsi)}
                >
                  <td className="py-1">{target.mmsi}</td>
                  <td className="py-1">
                    {target.name ?? '—'}
                    {stale && (
                      <span
                        className="ml-1 px-1 text-[10px] uppercase rounded bg-slate-800 text-slate-400"
                        title={`Last seen ${Math.round((Date.now() - target.lastSeenMs) / 1000)}s ago`}
                      >
                        stale
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {target.length !== undefined ? `${target.length.toFixed(0)}m` : '—'}
                  </td>
                  <td className="py-1 text-right">
                    {target.sog !== undefined ? (target.sog * MS_TO_KN).toFixed(1) : '—'}
                  </td>
                  <td className="py-1 text-right">
                    {target.cog !== undefined
                      ? `${String(Math.round(wrap360(target.cog * RAD_TO_DEG))).padStart(3, '0')}°`
                      : '—'}
                  </td>
                  <td className="py-1 text-right">
                    {cpa ? `${(cpa.rangeMeters / NM).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1 text-right">
                    {cpa ? `${(cpa.cpaMeters / NM).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1 text-right">{cpa ? fmtTcpa(cpa.tcpaSeconds) : '—'}</td>
                  <td
                    className="py-1 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {muted ? (
                      <button
                        type="button"
                        onClick={() => unmuteVessel(target.mmsi)}
                        title={`Re-arm now (would auto-arm at CPA < ${remutedTriggerNm!.toFixed(2)} NM)`}
                        className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-emerald-700 hover:text-slate-100 rounded"
                      >
                        muted ≥{remutedTriggerNm!.toFixed(2)}
                      </button>
                    ) : threat ? (
                      <button
                        type="button"
                        onClick={() => muteVessel(target.mmsi)}
                        title="Silence the klaxon for this vessel until CPA closes by 10%"
                        className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-red-700 hover:text-red-100 rounded"
                      >
                        Mute
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
