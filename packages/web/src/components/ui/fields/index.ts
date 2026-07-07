/**
 * components/ui/fields — Tier-1 Field Family
 *
 * One recipe for all form inputs: sunken well, --hairline border, r-control,
 * 44px height, focus ring; label voice above, caption/error below.
 *
 * Phase 6 (task-1):
 *   TextField  — text input + textarea
 *   NumberField — numeric input with 44px ± steppers
 *   CoordField  — coordinate input with lib/coords paste-anything parser
 *   SelectField — custom popover select (retires native selects)
 *   Slider      — range slider (retires .fc-slider)
 *   Checkbox    — 24px custom checkbox
 *   Radio       — 24px custom radio
 */

export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { NumberField } from './NumberField';
export type { NumberFieldProps } from './NumberField';

export { CoordField } from './CoordField';
export type { CoordFieldProps } from './CoordField';

export { SelectField } from './SelectField';
export type { SelectFieldProps, SelectOption } from './SelectField';

export { Slider } from './Slider';
export type { SliderProps } from './Slider';

export { Checkbox, Radio } from './Checkbox';
export type { CheckboxProps, RadioProps } from './Checkbox';
