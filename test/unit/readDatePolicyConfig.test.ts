/**
 * U3 — per-view date-policy + row-visibility option readers.
 *
 * Covers the coercion/defaulting rules for the Bases view options without an
 * Obsidian view. Two readers, two layers (#161, KTD7):
 * - `readDatePolicyConfig` → the controller's derivation input (`defaultDuration`).
 * - `readRowVisibilityOptions` → the view's presentation toggles (show-undated /
 *   show-partial): missing → shown; an explicit `false` hides.
 */

import {
  readDatePolicyConfig,
  readRowVisibilityOptions,
} from '../../src/bases/datePolicyConfig';

/** Build a `config.get`-style reader from a plain record. */
function getter(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key];
}

describe('readDatePolicyConfig', () => {
  it('defaults to duration 1 when the option is absent', () => {
    expect(readDatePolicyConfig(getter({}))).toEqual({ defaultDuration: 1 });
  });

  it('does not carry any row-visibility fields (derivation is visibility-free, KTD7)', () => {
    expect(readDatePolicyConfig(getter({ tngantt_showUndatedTasks: false }))).toEqual({
      defaultDuration: 1,
    });
  });

  it('passes a configured defaultDuration through to the policy', () => {
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: 3 })).defaultDuration).toBe(3);
  });

  it('coerces a numeric-string duration and floors fractional values', () => {
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: '5' })).defaultDuration).toBe(5);
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: 2.9 })).defaultDuration).toBe(2);
  });

  it('falls back to 1 for invalid or sub-1 durations', () => {
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: 0 })).defaultDuration).toBe(1);
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: -4 })).defaultDuration).toBe(1);
    expect(readDatePolicyConfig(getter({ tngantt_defaultDuration: 'abc' })).defaultDuration).toBe(1);
  });
});

describe('readRowVisibilityOptions', () => {
  it('defaults both toggles to shown when options are absent', () => {
    expect(readRowVisibilityOptions(getter({}))).toEqual({
      showUndatedTasks: true,
      showPartialDateTasks: true,
    });
  });

  it('hides a category only on an explicit false', () => {
    const opts = readRowVisibilityOptions(
      getter({ tngantt_showUndatedTasks: false, tngantt_showPartialDateTasks: false }),
    );
    expect(opts.showUndatedTasks).toBe(false);
    expect(opts.showPartialDateTasks).toBe(false);
  });

  it('treats a missing toggle as shown (not hidden)', () => {
    const opts = readRowVisibilityOptions(getter({ tngantt_showUndatedTasks: undefined }));
    expect(opts.showUndatedTasks).toBe(true);
  });
});
