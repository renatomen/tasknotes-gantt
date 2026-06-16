/**
 * U3 — per-view date-policy config reader.
 *
 * Covers the coercion/defaulting rules for the Bases view options without an
 * Obsidian view: missing options fall back to (duration 1, all shown); an
 * explicit `false` hides; `defaultDuration` coerces to an integer ≥ 1.
 */

import { readDatePolicyConfig } from '../../src/bases/datePolicyConfig';

/** Build a `config.get`-style reader from a plain record. */
function getter(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key];
}

describe('readDatePolicyConfig', () => {
  it('defaults to duration 1 and all toggles shown when options are absent', () => {
    expect(readDatePolicyConfig(getter({}))).toEqual({
      defaultDuration: 1,
      showUndatedTasks: true,
      showPartialDateTasks: true,
    });
  });

  it('passes a configured defaultDuration through to the policy', () => {
    expect(readDatePolicyConfig(getter({ defaultDuration: 3 })).defaultDuration).toBe(3);
  });

  it('coerces a numeric-string duration and floors fractional values', () => {
    expect(readDatePolicyConfig(getter({ defaultDuration: '5' })).defaultDuration).toBe(5);
    expect(readDatePolicyConfig(getter({ defaultDuration: 2.9 })).defaultDuration).toBe(2);
  });

  it('falls back to 1 for invalid or sub-1 durations', () => {
    expect(readDatePolicyConfig(getter({ defaultDuration: 0 })).defaultDuration).toBe(1);
    expect(readDatePolicyConfig(getter({ defaultDuration: -4 })).defaultDuration).toBe(1);
    expect(readDatePolicyConfig(getter({ defaultDuration: 'abc' })).defaultDuration).toBe(1);
  });

  it('hides a category only on an explicit false', () => {
    const cfg = readDatePolicyConfig(
      getter({ showUndatedTasks: false, showPartialDateTasks: false }),
    );
    expect(cfg.showUndatedTasks).toBe(false);
    expect(cfg.showPartialDateTasks).toBe(false);
  });

  it('treats a missing toggle as shown (not hidden)', () => {
    const cfg = readDatePolicyConfig(getter({ showUndatedTasks: undefined }));
    expect(cfg.showUndatedTasks).toBe(true);
  });
});
