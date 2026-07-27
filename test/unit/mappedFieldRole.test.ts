/**
 * mappedFieldRole unit tests — the shared bare-key → mapped-canonical-field
 * matcher behind the cell-editor resolver and the property-patch write path.
 *
 * Pins the matching mechanics both consumers rely on: every role matches by
 * bare form (`note.` prefix normalized on the mapping side), precedence is
 * caller-owned and first-match-wins, and unset/empty mappings never match.
 */

import { describe, it, expect } from '@jest/globals';
import { matchMappedFieldRole, type MappedFieldRole } from '../../src/bases/mappedFieldRole';
import type { FieldMappings } from '../../src/bases/types/field-mapping';

function mappings(over: Partial<FieldMappings> = {}): FieldMappings {
  return {
    textProperty: '',
    startProperty: '',
    endProperty: '',
    progressProperty: '',
    ...over,
  };
}

const ALL_ROLES: ReadonlyArray<MappedFieldRole> = [
  'start',
  'end',
  'text',
  'status',
  'priority',
  'progress',
  'estimate',
];

describe('matchMappedFieldRole', () => {
  const roleTable: Array<[MappedFieldRole, Partial<FieldMappings>, string]> = [
    ['start', { startProperty: 'note.begin' }, 'begin'],
    ['end', { endProperty: 'note.finish' }, 'finish'],
    ['text', { textProperty: 'note.name' }, 'name'],
    ['status', { statusProperty: 'note.state' }, 'state'],
    ['priority', { priorityProperty: 'note.urgency' }, 'urgency'],
    ['progress', { progressProperty: 'note.percent' }, 'percent'],
    ['estimate', { timeEstimateProperty: 'note.est' }, 'est'],
  ];

  it.each(roleTable)('matches the mapped %s property by bare key', (role, over, key) => {
    expect(matchMappedFieldRole(key, mappings(over), ALL_ROLES)).toBe(role);
  });

  it('matches a bare-form mapping (no note. prefix on the mapping side)', () => {
    expect(matchMappedFieldRole('due', mappings({ endProperty: 'due' }), ALL_ROLES)).toBe('end');
  });

  it('returns the FIRST precedence entry when one key is mapped to several roles', () => {
    const m = mappings({ textProperty: 'note.x', statusProperty: 'note.x' });
    expect(matchMappedFieldRole('x', m, ['text', 'status'])).toBe('text');
    expect(matchMappedFieldRole('x', m, ['status', 'text'])).toBe('status');
  });

  it('skips roles the caller leaves out of its precedence list', () => {
    const m = mappings({ statusProperty: 'note.state' });
    expect(matchMappedFieldRole('state', m, ['start', 'end'])).toBeNull();
  });

  it('never matches an unset optional mapping', () => {
    expect(matchMappedFieldRole('status', mappings(), ALL_ROLES)).toBeNull();
  });

  it('never matches an empty-string mapping', () => {
    expect(matchMappedFieldRole('anything', mappings(), ALL_ROLES)).toBeNull();
  });

  it('returns null for a key no mapping addresses', () => {
    const m = mappings({ startProperty: 'note.begin' });
    expect(matchMappedFieldRole('other', m, ALL_ROLES)).toBeNull();
  });
});
