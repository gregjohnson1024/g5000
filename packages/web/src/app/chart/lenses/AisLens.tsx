'use client';

import { Fragment, useState } from 'react';
import { useAisTargets, RANGE_OPTIONS_NM, NM } from '../../ais/use-ais-targets';
import { useThreatAudio } from '../../ais/use-threat-audio';
import { aisDetailRows, fmtTcpa } from '../../../lib/ais-detail';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../../lib/units';
import type { CpaResult } from '@g5000/compute';

// Sort state for the targets table.
// Threats always float to the top regardless of sort selection (safety invariant).
type SortKey = 'mmsi' | 'name' | 'length' | 'sog' | 'cog' | 'range' | 'cpa' | 'tcpa';

const COLUMNS: { k: SortKey; label: string; unit?: string; align: 'left' | 'right' }[] = [
  { k: 'name', label: 'Vessel', align: 'left' },
  { k: 'sog', label: 'SOG', unit: 'kn', align: 'right' },
  { k: 'range', label: 'Range', unit: 'NM', align: 'right' },
  { k: 'cpa', label: 'CPA', unit: 'NM', align: 'right' },
  { k: 'tcpa', label: 'TCPA', unit: 'min', align: 'right' },
];

function valueOf(
  r: {
    target: { mmsi: number; name?: string; length?: number; sog?: number; cog?: number };
    cpa: CpaResult | null;
    stale: boolean;
  },
  key: SortKey,
): number | string | null {
  switch (key) {
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
}

/**
 * AisLens — AIS target list inside the LayerDock (Phase 5 T2).
 *
 * Implements the §7.5 design exactly:
 * - Threats pinned to top (safety invariant)
 * - Per-vessel mute with CPA-snapshot auto-re-arm; mute re-arm rule is VISIBLE TEXT
 * - Stale targets (>60s) dimmed; excluded from klaxon
 * - Drop targets (>5min) excluded entirely
 * - Column headers carry units once (NM/kn/min) not per-cell
 * - Range persisted to ais:rangeNm (shared with /ais page)
 * - CPA/TCPA edit PUTs to /api/ais/alarm-config
 * - Audio Arm/Test in the lens header
 *
 * RadarScope is NOT rendered here (dock space; accepted loss per the brief).
 */
export function AisLens(): React.ReactElement {
  const {
    targetsWithCpa,
    alarmConfig,
    rangeNm,
    setRangeNm,
    isThreat,
    mutes,
    muteVessel,
    unmuteVessel,
    threatMmsis,
    toggleAlarmEnabled,
    saveThresholds,
    ownPos,
  } = useAisTargets();

  const {
    armed: audioArmed,
    arm: armAudio,
    test: testAudio,
    testing: audioTesting,
  } = useThreatAudio(threatMmsis, alarmConfig.enabled);

  const [sortKey, setSortKey] = useState<SortKey>('cpa');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const handleSort = (k: SortKey): void => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [showAlarmEdit, setShowAlarmEdit] = useState(false);
  const [draftCpaNm, setDraftCpaNm] = useState(() => alarmConfig.cpaMeters / NM);
  const [draftTcpaMin, setDraftTcpaMin] = useState(() => alarmConfig.tcpaSeconds / 60);

  // Sync draft values when config loads from the server
  const [configLoaded, setConfigLoaded] = useState(false);
  if (!configLoaded && alarmConfig.cpaMeters !== NM) {
    setDraftCpaNm(alarmConfig.cpaMeters / NM);
    setDraftTcpaMin(alarmConfig.tcpaSeconds / 60);
    setConfigLoaded(true);
  }

  const inRangeTargets = targetsWithCpa.filter(
    ({ cpa }) => cpa && cpa.rangeMeters < rangeNm * NM * 2,
  );

  const sortedTargets = [...inRangeTargets].sort((a, b) => {
    // Safety invariant: threats always float to the top
    const ta = !a.stale && isThreat(a.cpa) ? 0 : 1;
    const tb = !b.stale && isThreat(b.cpa) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const av = valueOf(a, sortKey);
    const bv = valueOf(b, sortKey);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const raw =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
    return sortDir === 'asc' ? raw : -raw;
  });

  const selectedRow =
    selectedMmsi !== null ? targetsWithCpa.find((r) => r.target.mmsi === selectedMmsi) : null;

  const threatCount = targetsWithCpa.filter(({ stale, cpa }) => !stale && isThreat(cpa)).length;

  return (
    <div className="flex flex-col gap-0 text-ink">
      {/* ── Header controls ──────────────────────────────────────── */}
      <div className="flex flex-col gap-1 px-1 py-2 border-b border-hairline">
        {/* Row 1: title + range */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
            Targets
            {threatCount > 0 && (
              <span className="ml-1.5 px-1 py-0.5 rounded text-[10px] bg-danger/20 text-danger border border-danger/40 font-mono">
                {threatCount} threat{threatCount !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          <label className="flex items-center gap-1 text-xs text-ink-3">
            <span>Range</span>
            <select
              value={rangeNm}
              onChange={(e) => setRangeNm(Number(e.target.value))}
              className="bg-surface-raised border border-hairline-strong rounded px-1.5 py-0.5 text-xs text-ink font-mono"
            >
              {RANGE_OPTIONS_NM.map((n) => (
                <option key={n} value={n}>
                  {n} NM
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Row 2: alarm toggle + audio */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => void toggleAlarmEnabled()}
            aria-pressed={alarmConfig.enabled}
            className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
              alarmConfig.enabled
                ? 'bg-ok/20 border-ok/40 text-ok'
                : 'bg-surface-raised border-hairline-strong text-ink-3'
            }`}
          >
            Alarm {alarmConfig.enabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => armAudio()}
            disabled={audioArmed}
            className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
              audioArmed
                ? 'bg-ok/20 border-ok/40 text-ok cursor-default'
                : 'bg-surface-raised border-hairline-strong text-ink-3 hover:text-ink'
            }`}
          >
            {audioArmed ? 'Audio armed' : 'Arm audio'}
          </button>
          <button
            type="button"
            onClick={() => testAudio()}
            disabled={!audioArmed || audioTesting}
            className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
              !audioArmed
                ? 'bg-surface border-hairline text-ink-4 cursor-not-allowed'
                : audioTesting
                  ? 'bg-danger/20 border-danger/40 text-danger cursor-default'
                  : 'bg-surface-raised border-hairline-strong text-ink-3 hover:text-ink'
            }`}
          >
            {audioTesting ? 'Testing…' : 'Test'}
          </button>
          {/* CPA/TCPA threshold button */}
          <button
            type="button"
            onClick={() => setShowAlarmEdit((v) => !v)}
            aria-expanded={showAlarmEdit}
            className="px-2 py-0.5 rounded text-[11px] font-mono border border-hairline-strong bg-surface-raised text-ink-3 hover:text-ink ml-auto"
          >
            CPA {(alarmConfig.cpaMeters / NM).toFixed(1)} · TCPA{' '}
            {Math.round(alarmConfig.tcpaSeconds / 60)} min
          </button>
        </div>

        {/* Threshold editor (inline, dismissible) */}
        {showAlarmEdit && (
          <div className="flex items-end gap-2 pt-1">
            <label className="flex flex-col gap-0.5 text-ink-3">
              <span className="text-[10px] uppercase tracking-wide">CPA (NM)</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={draftCpaNm}
                onChange={(e) => setDraftCpaNm(Number(e.target.value))}
                className="bg-surface-sunken border border-hairline-strong rounded px-2 py-0.5 w-20 font-mono text-xs text-ink"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-ink-3">
              <span className="text-[10px] uppercase tracking-wide">TCPA (min)</span>
              <input
                type="number"
                step="1"
                min="1"
                value={draftTcpaMin}
                onChange={(e) => setDraftTcpaMin(Number(e.target.value))}
                className="bg-surface-sunken border border-hairline-strong rounded px-2 py-0.5 w-20 font-mono text-xs text-ink"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                void saveThresholds(draftCpaNm, draftTcpaMin);
                setShowAlarmEdit(false);
              }}
              className="px-2 py-0.5 rounded text-xs bg-accent text-on-accent font-medium hover:bg-accent-hi"
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* ── No GPS fix guard ─────────────────────────────────────── */}
      {!ownPos && (
        <div className="px-3 py-4 text-xs text-ink-3 font-mono text-center">
          Waiting for GPS fix…
        </div>
      )}

      {/* ── Selected vessel detail ────────────────────────────────── */}
      {selectedRow && (
        <div className="px-2 py-2 border-b border-hairline bg-surface-raised">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-ink-3 uppercase tracking-wide">Selected</span>
            <button
              type="button"
              onClick={() => setSelectedMmsi(null)}
              className="text-[10px] text-ink-3 hover:text-ink px-1"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-y-0.5 text-xs font-mono">
            {aisDetailRows(selectedRow.target, selectedRow.cpa).map(([label, value]) => (
              <Fragment key={label}>
                <div className="text-ink-3">{label}</div>
                <div className="text-ink">{value}</div>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── Targets table ─────────────────────────────────────────── */}
      {ownPos && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-hairline">
                {COLUMNS.map(({ k, label, unit, align }) => {
                  const active = sortKey === k;
                  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
                  return (
                    <th
                      key={k}
                      onClick={() => handleSort(k)}
                      className={`py-1 px-1 ${
                        align === 'left' ? 'text-left' : 'text-right'
                      } cursor-pointer select-none text-ink-3 hover:text-ink-2 ${
                        active ? 'text-ink-2' : ''
                      } whitespace-nowrap`}
                    >
                      {label}
                      {unit && <span className="text-ink-4 ml-0.5">/{unit}</span>}
                      {arrow && <span className="ml-0.5 text-[9px]">{arrow}</span>}
                    </th>
                  );
                })}
                {/* Mute column — no sort */}
                <th className="py-1 px-1 text-right text-ink-3 whitespace-nowrap">Mute</th>
              </tr>
            </thead>
            <tbody>
              {sortedTargets.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-4 text-center text-ink-4">
                    No targets in range
                  </td>
                </tr>
              )}
              {sortedTargets.map(({ target, cpa, stale }) => {
                const threat = !stale && isThreat(cpa);
                const selected = selectedMmsi === target.mmsi;
                const mutedAt = mutes[target.mmsi];
                const muted = mutedAt !== undefined;
                // Re-arm trigger: muted ≥ X nm — visible text per §7.5
                const rearmTriggerNm = muted ? (mutedAt * 0.9) / NM : null;

                const rowClass = stale
                  ? 'text-ink-4 italic'
                  : muted
                    ? 'text-ink-3'
                    : threat
                      ? 'text-danger'
                      : 'text-ink';

                return (
                  <tr
                    key={target.mmsi}
                    onClick={() =>
                      setSelectedMmsi(target.mmsi === selectedMmsi ? null : target.mmsi)
                    }
                    className={`border-b border-hairline cursor-pointer hover:bg-surface-raised transition-colors ${
                      selected ? 'bg-surface-raised' : ''
                    } ${rowClass}`}
                  >
                    {/* Vessel name */}
                    <td className="py-1 px-1 max-w-[90px] truncate">
                      {threat && !muted && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger mr-1 align-middle" />
                      )}
                      {target.name ?? `#${target.mmsi}`}
                      {stale && (
                        <span className="ml-1 px-1 text-[9px] uppercase rounded bg-surface-raised text-ink-4">
                          stale
                        </span>
                      )}
                    </td>
                    {/* SOG (kn) */}
                    <td className="py-1 px-1 text-right tabular-nums">
                      {target.sog !== undefined ? (target.sog * MS_TO_KN).toFixed(1) : '—'}
                    </td>
                    {/* Range (NM) */}
                    <td className="py-1 px-1 text-right tabular-nums">
                      {cpa ? (cpa.rangeMeters / NM).toFixed(2) : '—'}
                    </td>
                    {/* CPA (NM) */}
                    <td className="py-1 px-1 text-right tabular-nums">
                      {cpa ? (cpa.cpaMeters / NM).toFixed(2) : '—'}
                    </td>
                    {/* TCPA (m:ss → shown as min here) */}
                    <td className="py-1 px-1 text-right tabular-nums">
                      {cpa ? fmtTcpa(cpa.tcpaSeconds) : '—'}
                    </td>
                    {/* Mute / unmute — stopPropagation so row-click doesn't also select */}
                    <td
                      className="py-1 px-1 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {muted ? (
                        <button
                          type="button"
                          onClick={() => unmuteVessel(target.mmsi)}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-surface-raised border border-hairline-strong text-ink-3 hover:text-ok hover:border-ok/40 whitespace-nowrap"
                        >
                          {/* Visible re-arm rule per §7.5 — was a title= tooltip */}
                          muted ≥{rearmTriggerNm!.toFixed(2)} nm
                        </button>
                      ) : threat ? (
                        <button
                          type="button"
                          onClick={() => muteVessel(target.mmsi)}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-danger/20 border border-danger/40 text-danger hover:bg-surface-raised"
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
      )}
    </div>
  );
}
