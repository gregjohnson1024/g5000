/**
 * Pure helpers for <RaceSettings>. Lives in its own file so the
 * validation logic is testable without a DOM testing harness (packages/web
 * has no jsdom / testing-library setup as of this commit).
 */

export interface Settings {
  shiftThresholdDeg: number;
  ocsLookAheadSec: number;
  laylineDistanceNm: number;
  integrateCurrent: boolean;
}

export interface NumberFieldDef {
  key: 'shiftThresholdDeg' | 'ocsLookAheadSec' | 'laylineDistanceNm';
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export const NUMBER_FIELDS: NumberFieldDef[] = [
  {
    key: 'shiftThresholdDeg',
    label: 'Wind shift threshold',
    unit: '°',
    min: 1,
    max: 30,
    step: 1,
    defaultValue: 7,
  },
  {
    key: 'ocsLookAheadSec',
    label: 'OCS look-ahead',
    unit: 's',
    min: 3,
    max: 60,
    step: 1,
    defaultValue: 10,
  },
  {
    key: 'laylineDistanceNm',
    label: 'Layline distance',
    unit: 'NM',
    min: 1,
    max: 15,
    step: 1,
    defaultValue: 5,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  shiftThresholdDeg: 7,
  ocsLookAheadSec: 10,
  laylineDistanceNm: 5,
  integrateCurrent: true,
};

export function isInRange(field: NumberFieldDef, value: number): boolean {
  return Number.isFinite(value) && value >= field.min && value <= field.max;
}

export function isModified(a: Settings, b: Settings): boolean {
  return (
    a.shiftThresholdDeg !== b.shiftThresholdDeg ||
    a.ocsLookAheadSec !== b.ocsLookAheadSec ||
    a.laylineDistanceNm !== b.laylineDistanceNm ||
    a.integrateCurrent !== b.integrateCurrent
  );
}

/**
 * Merge a partial Settings object from the server with the defaults.
 * Used at mount so missing keys (older persisted state) don't render
 * as `undefined` in form inputs.
 */
export function mergeWithDefaults(partial: Partial<Settings> | undefined): Settings {
  return {
    shiftThresholdDeg: partial?.shiftThresholdDeg ?? DEFAULT_SETTINGS.shiftThresholdDeg,
    ocsLookAheadSec: partial?.ocsLookAheadSec ?? DEFAULT_SETTINGS.ocsLookAheadSec,
    laylineDistanceNm: partial?.laylineDistanceNm ?? DEFAULT_SETTINGS.laylineDistanceNm,
    integrateCurrent: partial?.integrateCurrent ?? DEFAULT_SETTINGS.integrateCurrent,
  };
}

/**
 * Run all field validators; returns human-readable error strings for
 * any out-of-range numbers. Empty array = clean. Used both to disable
 * the Save button and to render inline errors.
 */
export function validateAll(s: Settings): string[] {
  return NUMBER_FIELDS.flatMap((f) =>
    isInRange(f, s[f.key]) ? [] : [`${f.label} must be ${f.min}–${f.max} ${f.unit}`],
  );
}
