/**
 * Unit tests for the SVAR-contract snapshot readers against state shaped like
 * the REAL store (transcribed from `@svar-ui/gantt-store`'s `resetScales`
 * output): `_scales` carries `diff`, the config-level `lengthUnit`, and the
 * rendered minor cell unit `minUnit`. The month-zoom shape is the live-store
 * defect state pinned here: `lengthUnit` stays 'day' (SVAR keeps any length
 * unit measurable within the min unit) while `minUnit` is 'month'.
 *
 * The browser probe (`svar-contract.probe.ts`) validates the same expectations
 * against the real library; these run in jest for the fast red/green loop.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { IApi } from '@svar-ui/svelte-gantt';
import { scaleSnapshot } from '../../src/render/svarContract';
import { canTileSubSpans } from '../../src/render/segmentLayout';

/** An api stub over a real-shaped `getState()` result. */
function apiWith(state: Record<string, unknown>): IApi {
  return { getState: () => state } as unknown as IApi;
}

const diff = (): number => 0;

/** `_scales` as `resetScales` returns it at the given zoom's units. */
function scalesState(minUnit: string, lengthUnit: string): Record<string, unknown> {
  return {
    durationUnit: 'day',
    _scales: {
      rows: [],
      width: 1200,
      height: 60,
      start: new Date(2026, 1, 1),
      end: new Date(2026, 5, 1),
      lengthUnit,
      minUnit,
      lengthUnitWidth: 2.3,
      diff,
    },
  };
}

describe('scaleSnapshot — rendered cell unit capture', () => {
  it('captures minUnit alongside diff and lengthUnit from a day-zoom store', () => {
    const snap = scaleSnapshot(apiWith(scalesState('day', 'day')));

    expect(snap).toEqual({ diff, lengthUnit: 'day', minUnit: 'day', durationUnit: 'day' });
  });

  it('reports the month cell unit while the config lengthUnit stays day (month zoom)', () => {
    const snap = scaleSnapshot(apiWith(scalesState('month', 'day')));

    expect(snap).not.toBeNull();
    expect(snap!.minUnit).toBe('month');
    expect(snap!.lengthUnit).toBe('day');
    // The consumer contract this exists for: month cells must refuse tiling.
    expect(canTileSubSpans(snap!)).toBe(false);
  });

  it('degrades to null, warning once, when minUnit is missing (SVAR moved it)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = scalesState('day', 'day');
      delete (state._scales as Record<string, unknown>).minUnit;

      expect(scaleSnapshot(apiWith(state))).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('degrades to null when _scales is absent entirely', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(scaleSnapshot(apiWith({}))).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
