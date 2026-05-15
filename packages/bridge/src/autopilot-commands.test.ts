import { describe, expect, it } from 'vitest';
import { resolveCommand } from './autopilot-commands.js';

describe('resolveCommand', () => {
  it('resolves standby to canboat-documented Event=Standby fields', () => {
    const r = resolveCommand('standby', { version: 1, captures: {} });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields['Proprietary ID']).toBe('Autopilot');
      expect(r.fields['Command Type']).toBe('AP Command');
      expect(r.fields['Event']).toBe('Standby');
    }
  });

  it('resolves auto to Event=Heading mode', () => {
    const r = resolveCommand('auto', { version: 1, captures: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields['Event']).toBe('Heading mode');
  });

  it('resolves nav / wind / no_drift to their canboat Events', () => {
    expect(resolveCommand('nav', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'Nav mode' }),
    });
    expect(resolveCommand('wind', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'Wind mode' }),
    });
    expect(resolveCommand('no_drift', { version: 1, captures: {} })).toMatchObject({
      ok: true, fields: expect.objectContaining({ Event: 'No Drift mode' }),
    });
  });

  it('returns missing_capture when course_+1 has no capture entry', () => {
    const r = resolveCommand('course_+1', { version: 1, captures: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('missing_capture');
  });

  it('returns the capture fields when course_+1 has an entry', () => {
    const r = resolveCommand('course_+1', {
      version: 1,
      captures: {
        'course_+1': { fields: { 'Proprietary ID': 'Autopilot', Event: 'Change course', Direction: 'Starboard', Angle: 1 } },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields['Direction']).toBe('Starboard');
      expect(r.fields['Angle']).toBe(1);
    }
  });

  it('rejects unknown_event', () => {
    // @ts-expect-error testing the runtime guard
    const r = resolveCommand('bogus', { version: 1, captures: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unknown_event');
  });
});
