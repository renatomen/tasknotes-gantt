/**
 * U4 — the composed row-visibility predicate (#161).
 *
 * Truth table for {@link shouldHideRow}: each option independently hides only its
 * own class; the default (show-everything) hides nothing; options compose. Plus
 * {@link anyRowFilterActive} gating the view's clear path.
 */

import {
  shouldHideRow,
  anyRowFilterActive,
  type RowVisibilityFlags,
  type RowVisibilityInput,
} from '../../src/bases/rowVisibility';
import type { DateStatus } from '../../src/controller/datePolicy';

/** All options show-everything (the default). */
const SHOW_ALL: RowVisibilityFlags = {
  hideTopLevel: false,
  showUndated: true,
  showPartial: true,
};

/** A row of a given date status; not a top-level duplicate unless asked. */
function row(dateStatus: DateStatus, isTopLevelPlacement = false): RowVisibilityInput {
  return { dateStatus, isTopLevelPlacement };
}

describe('shouldHideRow', () => {
  it('hides nothing when every option is show-everything (default)', () => {
    for (const s of ['complete', 'inferred-start', 'inferred-end', 'placeholder', 'swapped'] as const) {
      expect(shouldHideRow(row(s), SHOW_ALL)).toBe(false);
      expect(shouldHideRow(row(s, true), SHOW_ALL)).toBe(false);
    }
  });

  it('hide-top hides ONLY a top-level duplicate, regardless of date status', () => {
    const flags = { ...SHOW_ALL, hideTopLevel: true };
    expect(shouldHideRow(row('complete', true), flags)).toBe(true);
    expect(shouldHideRow(row('placeholder', true), flags)).toBe(true);
    // A non-duplicate row is untouched by hide-top.
    expect(shouldHideRow(row('complete', false), flags)).toBe(false);
  });

  it('show-undated off hides ONLY placeholder rows', () => {
    const flags = { ...SHOW_ALL, showUndated: false };
    expect(shouldHideRow(row('placeholder'), flags)).toBe(true);
    expect(shouldHideRow(row('inferred-start'), flags)).toBe(false);
    expect(shouldHideRow(row('complete'), flags)).toBe(false);
  });

  it('show-partial off hides ONLY one-date (inferred) rows', () => {
    const flags = { ...SHOW_ALL, showPartial: false };
    expect(shouldHideRow(row('inferred-start'), flags)).toBe(true);
    expect(shouldHideRow(row('inferred-end'), flags)).toBe(true);
    expect(shouldHideRow(row('placeholder'), flags)).toBe(false);
    expect(shouldHideRow(row('complete'), flags)).toBe(false);
  });

  it('composes options: a complete non-duplicate row is never hidden by any combination', () => {
    const flags = { hideTopLevel: true, showUndated: false, showPartial: false };
    expect(shouldHideRow(row('complete', false), flags)).toBe(false);
    // ...but a complete DUPLICATE is hidden by hide-top.
    expect(shouldHideRow(row('complete', true), flags)).toBe(true);
    // ...and an undated DUPLICATE is hidden (either rule suffices).
    expect(shouldHideRow(row('placeholder', true), flags)).toBe(true);
  });
});

describe('anyRowFilterActive', () => {
  it('is false only when every option is show-everything (clear-path gate)', () => {
    expect(anyRowFilterActive(SHOW_ALL)).toBe(false);
  });

  it('is true when any single option is active', () => {
    expect(anyRowFilterActive({ ...SHOW_ALL, hideTopLevel: true })).toBe(true);
    expect(anyRowFilterActive({ ...SHOW_ALL, showUndated: false })).toBe(true);
    expect(anyRowFilterActive({ ...SHOW_ALL, showPartial: false })).toBe(true);
  });
});
