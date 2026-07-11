/**
 * gridContext unit tests — the Svelte context keys `GanttContainer` uses to hand
 * values (App, date-locale, editable column set) down to SVAR-mounted grid
 * cells. The keys carry no logic, but they share a single context namespace:
 * any two that collide would silently clobber each other, so their
 * distinctness is a real contract worth pinning.
 */

import { describe, it, expect } from '@jest/globals';
import {
  GRID_APP_CONTEXT_KEY,
  GRID_DATE_LOCALE_CONTEXT_KEY,
  GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
} from '../../src/bases/gridContext';

const KEYS = [
  GRID_APP_CONTEXT_KEY,
  GRID_DATE_LOCALE_CONTEXT_KEY,
  GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
];

describe('gridContext keys', () => {
  it('are all non-empty strings', () => {
    for (const key of KEYS) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('are mutually distinct so no cell context clobbers another', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });
});
