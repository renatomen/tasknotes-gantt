/**
 * U3: dateFieldMapping pure-resolver unit tests.
 *
 * Resolves a configured (bare) frontmatter property name + role to a
 * { readProp, writeTarget, invalid } via the TaskNotes FieldConfig:
 * - unset → role default (scheduled/due)
 * - == scheduledProp/dueProp → canonical target
 * - == an enabled custom date field key → userField target
 * - anything else → invalid, symmetric fallback to the role default
 *
 * Plus the property-form helpers (note. prefix strip/add).
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveDateMapping,
  bareProperty,
  toNoteProperty,
} from '../../src/datasource/dateFieldMapping';
import type { FieldConfig } from '../../src/datasource/types';

const cfg: FieldConfig = {
  scheduledProp: 'scheduled',
  dueProp: 'due',
  dateFields: [
    { key: 'start', id: 'uf_start', displayName: 'Start' },
    { key: 'kickoff', id: 'uf_kickoff', displayName: 'Kickoff' },
  ],
};

describe('resolveDateMapping', () => {
  it('defaults an unset start to the scheduled property + scheduled target', () => {
    expect(resolveDateMapping(undefined, 'start', cfg)).toEqual({
      readProp: 'scheduled',
      writeTarget: { kind: 'scheduled' },
      invalid: false,
    });
  });

  it('defaults an unset end to the due property + due target', () => {
    expect(resolveDateMapping(undefined, 'end', cfg)).toEqual({
      readProp: 'due',
      writeTarget: { kind: 'due' },
      invalid: false,
    });
  });

  it('maps a property equal to scheduledProp to the scheduled target', () => {
    expect(resolveDateMapping('scheduled', 'start', cfg)).toEqual({
      readProp: 'scheduled',
      writeTarget: { kind: 'scheduled' },
      invalid: false,
    });
  });

  it('maps a property equal to dueProp to the due target', () => {
    expect(resolveDateMapping('due', 'end', cfg)).toEqual({
      readProp: 'due',
      writeTarget: { kind: 'due' },
      invalid: false,
    });
  });

  it('maps an enabled custom date field key to a userField target (covers #70)', () => {
    expect(resolveDateMapping('start', 'start', cfg)).toEqual({
      readProp: 'start',
      writeTarget: { kind: 'userField', key: 'start', id: 'uf_start' },
      invalid: false,
    });
  });

  it('falls back symmetrically to the role default when the property is invalid', () => {
    // 'notes' is not scheduled/due nor a custom date field → invalid.
    expect(resolveDateMapping('notes', 'start', cfg)).toEqual({
      readProp: 'scheduled',
      writeTarget: { kind: 'scheduled' },
      invalid: true,
    });
    expect(resolveDateMapping('notes', 'end', cfg)).toEqual({
      readProp: 'due',
      writeTarget: { kind: 'due' },
      invalid: true,
    });
  });

  it('falls back to the canonical name when fieldConfig lacks scheduled/due props', () => {
    const bare: FieldConfig = { scheduledProp: null, dueProp: null, dateFields: [] };
    expect(resolveDateMapping(undefined, 'start', bare)).toEqual({
      readProp: 'scheduled',
      writeTarget: { kind: 'scheduled' },
      invalid: false,
    });
  });
});

describe('bareProperty / toNoteProperty', () => {
  it('strips a note. prefix', () => {
    expect(bareProperty('note.start')).toBe('start');
  });

  it('strips a note: prefix', () => {
    expect(bareProperty('note:start')).toBe('start');
  });

  it('passes through a bare name', () => {
    expect(bareProperty('start')).toBe('start');
  });

  it('returns undefined for empty/undefined', () => {
    expect(bareProperty(undefined)).toBeUndefined();
    expect(bareProperty('')).toBeUndefined();
  });

  it('re-forms a bare name to note. dot-form', () => {
    expect(toNoteProperty('start')).toBe('note.start');
  });
});
