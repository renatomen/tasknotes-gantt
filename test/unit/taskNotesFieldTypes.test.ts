/**
 * taskNotesFieldTypes unit tests (grid markdown cell rendering, U1).
 *
 * Verifies the view-layer reader of TaskNotes custom user-field types: all types
 * (not just date) keyed by lowercased frontmatter key, autosuggestFilter carried,
 * disabled/keyless/typeless fields dropped, and graceful empty on any failure.
 */

import { describe, it, expect } from '@jest/globals';
import type { App } from 'obsidian';
import { resolveUserFieldTypes } from '../../src/bases/taskNotesFieldTypes';

function makeApp(config: unknown, opts: { present?: boolean; throws?: boolean } = {}): App {
  const present = opts.present ?? true;
  const api = {
    model: {
      config: () => {
        if (opts.throws) throw new Error('boom');
        return config;
      },
    },
  };
  return {
    plugins: {
      getPlugin: (id: string) => (present && id === 'tasknotes' ? { api } : undefined),
    },
  } as unknown as App;
}

describe('resolveUserFieldTypes', () => {
  it('maps every enabled user field by lowercased key with its type', () => {
    const app = makeApp({
      userFields: [
        { key: 'Assignee', type: 'list' },
        { key: 'effort', type: 'number' },
      ],
    });
    const map = resolveUserFieldTypes(app);
    expect(map.get('assignee')).toEqual({ type: 'list', autosuggestFilter: undefined });
    expect(map.get('effort')?.type).toBe('number');
  });

  it('carries the autosuggestFilter verbatim', () => {
    const filter = { includeFolders: ['People'] };
    const app = makeApp({ userFields: [{ key: 'owner', type: 'text', autosuggestFilter: filter }] });
    expect(resolveUserFieldTypes(app).get('owner')?.autosuggestFilter).toBe(filter);
  });

  it('excludes an explicitly disabled field', () => {
    const app = makeApp({ userFields: [{ key: 'x', type: 'text', enabled: false }] });
    expect(resolveUserFieldTypes(app).has('x')).toBe(false);
  });

  it('drops fields missing a key or a type', () => {
    const app = makeApp({ userFields: [{ type: 'text' }, { key: 'y' }, { key: '', type: 'text' }] });
    expect(resolveUserFieldTypes(app).size).toBe(0);
  });

  it('returns an empty map when TaskNotes is absent', () => {
    expect(resolveUserFieldTypes(makeApp({ userFields: [] }, { present: false })).size).toBe(0);
  });

  it('returns an empty map when model.config throws', () => {
    expect(resolveUserFieldTypes(makeApp({}, { throws: true })).size).toBe(0);
  });

  it('returns an empty map when there is no config', () => {
    expect(resolveUserFieldTypes(makeApp(null)).size).toBe(0);
  });
});
