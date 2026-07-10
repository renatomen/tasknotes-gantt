/**
 * cellRenderType unit tests (grid markdown cell rendering, U3).
 *
 * Verifies the TaskNotes -> Obsidian widget -> Bases value-shape precedence,
 * the tag-pill trigger (only the `tags` widget, never a TaskNotes field), and
 * the prefix-strip / lowercase key handling.
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveCellRenderType,
  type RenderTypeDeps,
  type TaskNotesFieldMeta,
} from '../../src/bases/cellRenderType';
import type { TypedValueKind } from '../../src/bases/propertyValues';

function deps(overrides: Partial<RenderTypeDeps> = {}): RenderTypeDeps {
  return {
    taskNotesFieldType: () => null,
    obsidianWidget: () => null,
    valueKind: 'text',
    ...overrides,
  };
}

describe('resolveCellRenderType — TaskNotes precedence', () => {
  it('uses TaskNotes text type -> markdown, even when the widget map says tags (AE3)', () => {
    const tn: TaskNotesFieldMeta = { type: 'text' };
    const result = resolveCellRenderType('note.assignee', {
      ...deps({ obsidianWidget: () => 'tags' }),
      taskNotesFieldType: (key) => (key === 'assignee' ? tn : null),
    });
    expect(result).toEqual({ display: 'markdown', tags: false, fieldMeta: tn });
  });

  it('maps TaskNotes list -> markdown and number/date/boolean -> conventional', () => {
    const mk = (type: string) =>
      resolveCellRenderType('note.f', deps({ taskNotesFieldType: () => ({ type }) }));
    expect(mk('list').display).toBe('markdown');
    expect(mk('number').display).toBe('conventional');
    expect(mk('date').display).toBe('conventional');
    expect(mk('boolean').display).toBe('conventional');
  });

  it('carries the TaskNotes fieldMeta (type + autosuggestFilter) through for the editor', () => {
    const tn: TaskNotesFieldMeta = { type: 'text', autosuggestFilter: { includeFolders: ['People'] } };
    const result = resolveCellRenderType('note.owner', deps({ taskNotesFieldType: () => tn }));
    expect(result.fieldMeta).toBe(tn);
  });
});

describe('resolveCellRenderType — Obsidian widget', () => {
  it('renders the tags widget as markdown with tag injection on', () => {
    expect(resolveCellRenderType('note.tags', deps({ obsidianWidget: () => 'tags' }))).toEqual({
      display: 'markdown',
      tags: true,
    });
  });

  it('renders text/multitext/aliases widgets as markdown without tag injection', () => {
    for (const w of ['text', 'multitext', 'aliases']) {
      expect(resolveCellRenderType('note.x', deps({ obsidianWidget: () => w }))).toEqual({
        display: 'markdown',
        tags: false,
      });
    }
  });

  it('renders date/datetime/number/checkbox widgets as conventional', () => {
    for (const w of ['date', 'datetime', 'number', 'checkbox']) {
      expect(resolveCellRenderType('note.x', deps({ obsidianWidget: () => w })).display).toBe(
        'conventional',
      );
    }
  });
});

describe('resolveCellRenderType — value-shape fallback', () => {
  it('renders link/text/list value kinds as markdown when no type source decides', () => {
    for (const kind of ['link', 'text', 'list'] as TypedValueKind[]) {
      expect(resolveCellRenderType('note.x', deps({ valueKind: kind })).display).toBe('markdown');
    }
  });

  it('renders date/number/boolean/empty value kinds as conventional', () => {
    for (const kind of ['date', 'number', 'boolean', 'empty'] as TypedValueKind[]) {
      expect(resolveCellRenderType('note.x', deps({ valueKind: kind })).display).toBe(
        'conventional',
      );
    }
  });
});

describe('resolveCellRenderType — non-frontmatter columns', () => {
  it('ignores TaskNotes/widget for a formula.* column that name-collides with a frontmatter field', () => {
    const result = resolveCellRenderType('formula.assignee', {
      taskNotesFieldType: () => ({ type: 'text' }),
      obsidianWidget: () => 'tags',
      valueKind: 'number',
    });
    // Value shape wins — a computed number must not inherit the frontmatter renderer.
    expect(result).toEqual({ display: 'conventional', tags: false });
  });

  it('ignores TaskNotes/widget for a file.* column, resolving by value shape', () => {
    const result = resolveCellRenderType('file.name', {
      taskNotesFieldType: () => ({ type: 'text' }),
      obsidianWidget: () => 'tags',
      valueKind: 'link',
    });
    expect(result).toEqual({ display: 'markdown', tags: false });
  });
});

describe('resolveCellRenderType — key handling', () => {
  it('strips the property-id prefix before lookup (note.assignee -> assignee)', () => {
    const seen: string[] = [];
    resolveCellRenderType('note.assignee', deps({ taskNotesFieldType: (k) => { seen.push(k); return null; } }));
    expect(seen).toContain('assignee');
  });

  it('handles an unprefixed property id', () => {
    const seen: string[] = [];
    resolveCellRenderType('assignee', deps({ obsidianWidget: (k) => { seen.push(k); return null; } }));
    expect(seen).toContain('assignee');
  });
});
