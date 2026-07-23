/**
 * Per-view scope class: each Gantt instance gets a unique `og-gantt-<token>` so
 * its injected stylesheets stay scoped to itself and can't leak onto a sibling.
 */
import { describe, it, expect } from '@jest/globals';
import { nextInstanceScopeClass } from '../../src/bases/instanceScope';

describe('nextInstanceScopeClass', () => {
  it('returns an og-gantt- prefixed class token', () => {
    expect(nextInstanceScopeClass()).toMatch(/^og-gantt-[0-9a-z]+$/);
  });

  it('returns a distinct class on every call (per-instance uniqueness)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(nextInstanceScopeClass());
    expect(seen.size).toBe(100);
  });
});
