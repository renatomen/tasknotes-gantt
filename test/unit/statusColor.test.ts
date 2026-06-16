/**
 * statusColor unit tests (U5).
 *
 * Pure helpers for status-driven bar coloring:
 * - statusSlug: CSS-safe, stable, collision-resistant tokens for arbitrary
 *   (emoji/symbol/space) status values
 * - buildStatusStyleRules: one deduped, scoped rule per present+colored status;
 *   omits absent statuses, missing colors, and unsafe color values
 */

import { describe, it, expect } from '@jest/globals';
import {
  statusSlug,
  buildStatusStyleRules,
  STATUS_CLASS_PREFIX,
} from '../../src/bases/statusColor';
import type { StatusColor } from '../../src/datasource/types';

describe('statusSlug', () => {
  it('produces a CSS-safe token (prefix + [a-z0-9-]) for an emoji/space value', () => {
    const slug = statusSlug('11🟥Active = Now');
    expect(slug.startsWith(STATUS_CLASS_PREFIX)).toBe(true);
    expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('is stable for the same input', () => {
    expect(statusSlug('41🟩Done = Recent')).toBe(statusSlug('41🟩Done = Recent'));
  });

  it('does not collide for distinct values whose readable parts coincide', () => {
    // Both sanitize to "active" but the raw values differ → distinct slugs.
    expect(statusSlug('🟥Active')).not.toBe(statusSlug('🟧Active'));
  });

  it('still yields a valid token for an all-symbol value (no readable part)', () => {
    const slug = statusSlug('🟥🟩');
    expect(slug.startsWith(STATUS_CLASS_PREFIX)).toBe(true);
    expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('buildStatusStyleRules', () => {
  const colors: StatusColor[] = [
    { value: '11🟥Active = Now', color: '#f8312f', isCompleted: false },
    { value: '41🟩Done = Recent', color: '#00d26a', isCompleted: true },
    { value: 'Unused', color: '#123456', isCompleted: false },
  ];

  it('emits a scoped background rule for each present, colored status', () => {
    const css = buildStatusStyleRules(
      [{ status: '11🟥Active = Now' }, { status: '41🟩Done = Recent' }],
      colors,
    );
    expect(css).toContain(`.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')}`);
    expect(css).toContain('background-color: #f8312f;');
    expect(css).toContain('background-color: #00d26a;');
  });

  it('omits statuses that are not present on any instance', () => {
    const css = buildStatusStyleRules([{ status: '11🟥Active = Now' }], colors);
    expect(css).not.toContain('#123456'); // "Unused" has no instance
    expect(css).not.toContain('#00d26a'); // "Done" has no instance
  });

  it('dedupes a status that appears on multiple instances', () => {
    const css = buildStatusStyleRules(
      [{ status: '11🟥Active = Now' }, { status: '11🟥Active = Now' }],
      colors,
    );
    expect(css.match(/background-color: #f8312f;/g)).toHaveLength(1);
  });

  it('skips a status with no configured color', () => {
    const css = buildStatusStyleRules([{ status: 'Orphan' }], colors);
    expect(css).toBe('');
  });

  it('skips an unsafe color value (CSS-injection guard)', () => {
    const css = buildStatusStyleRules(
      [{ status: 'Evil' }],
      [{ value: 'Evil', color: 'red; } body { display: none', isCompleted: false }],
    );
    expect(css).toBe('');
  });

  it('returns empty string when there are no colors', () => {
    expect(buildStatusStyleRules([{ status: 'x' }], [])).toBe('');
  });
});
