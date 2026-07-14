/**
 * cellEditability unit tests (inline cell editing — per-column editor resolution).
 *
 * Verifies the pure editor-descriptor resolver: computed/name columns never get
 * an editor, mapped canonical fields resolve their dedicated editors (gated by
 * progress/estimate writability), registered TaskNotes user fields resolve by
 * their TaskNotes type, and everything else — notably unregistered note.*
 * properties — resolves to none.
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveCellEditor,
  type CellEditorDeps,
} from '../../src/bases/cellEditability';
import type { TaskNotesFieldMeta } from '../../src/bases/cellRenderType';
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

function deps(over: Partial<CellEditorDeps> = {}): CellEditorDeps {
  return {
    taskNotesFieldType: over.taskNotesFieldType ?? (() => null),
    mappings: over.mappings ?? mappings(),
    progressWritable: over.progressWritable ?? false,
    estimateWritable: over.estimateWritable ?? false,
    statusWritable: over.statusWritable ?? true,
    priorityWritable: over.priorityWritable ?? true,
    isNameColumn: over.isNameColumn ?? false,
  };
}

describe('resolveCellEditor — status/priority mapped away from TaskNotes own field', () => {
  it('offers no status editor when the mapped property is not the one TaskNotes writes', () => {
    // TaskNotes persists status through ITS configured property, so a view that reads
    // status from a different property could only be "edited" by writing somewhere the
    // column does not show — the picker would look like it saved and change nothing.
    const m = mappings({ statusProperty: 'note.state' });

    expect(resolveCellEditor('note.state', deps({ mappings: m, statusWritable: false }))).toBeNull();
  });

  it('offers no priority editor when the mapped property is not the one TaskNotes writes', () => {
    const m = mappings({ priorityProperty: 'note.urgency' });

    expect(
      resolveCellEditor('note.urgency', deps({ mappings: m, priorityWritable: false })),
    ).toBeNull();
  });

  it('offers the status picker when the mapped property is the one TaskNotes writes', () => {
    const m = mappings({ statusProperty: 'note.status' });

    expect(resolveCellEditor('note.status', deps({ mappings: m, statusWritable: true }))).toEqual({
      kind: 'choice-status',
    });
  });
});

/** A taskNotesFieldType lookup serving one registered field by bare key. */
function registered(key: string, meta: TaskNotesFieldMeta): CellEditorDeps['taskNotesFieldType'] {
  return (k) => (k === key ? meta : null);
}

describe('resolveCellEditor — computed and name columns', () => {
  it('resolves file.* to no editor', () => {
    expect(resolveCellEditor('file.name', deps())).toBeNull();
  });

  it('resolves formula.* to no editor even when its bare name is mapped', () => {
    const d = deps({ mappings: mappings({ endProperty: 'note.due' }) });
    expect(resolveCellEditor('formula.due', d)).toBeNull();
  });

  it('resolves the name column to no editor even for a registered field', () => {
    const d = deps({
      isNameColumn: true,
      taskNotesFieldType: registered('title', { type: 'text' }),
    });
    expect(resolveCellEditor('note.title', d)).toBeNull();
  });

  it('resolves the mapped text property to no editor (title edits stay with the modal)', () => {
    const d = deps({ mappings: mappings({ textProperty: 'note.title' }) });
    expect(resolveCellEditor('note.title', d)).toBeNull();
  });
});

describe('resolveCellEditor — mapped canonical fields', () => {
  it('resolves the mapped start property to a date editor carrying the start role', () => {
    const d = deps({ mappings: mappings({ startProperty: 'note.start' }) });
    expect(resolveCellEditor('note.start', d)).toEqual({ kind: 'date', dateRole: 'start' });
  });

  it('resolves the mapped end property to a date editor (end role) across prefix forms', () => {
    const d = deps({ mappings: mappings({ endProperty: 'due' }) });
    expect(resolveCellEditor('note.due', d)).toEqual({ kind: 'date', dateRole: 'end' });
  });

  it('resolves the mapped status property to the status choice editor', () => {
    const d = deps({ mappings: mappings({ statusProperty: 'note.status' }) });
    expect(resolveCellEditor('note.status', d)).toEqual({ kind: 'choice-status' });
  });

  it('resolves the mapped priority property to the priority choice editor', () => {
    const d = deps({ mappings: mappings({ priorityProperty: 'note.priority' }) });
    expect(resolveCellEditor('note.priority', d)).toEqual({ kind: 'choice-priority' });
  });

  it('resolves the mapped progress property to a number editor only when writable', () => {
    const m = mappings({ progressProperty: 'note.done' });
    expect(resolveCellEditor('note.done', deps({ mappings: m, progressWritable: true }))).toEqual({
      kind: 'number',
    });
    expect(resolveCellEditor('note.done', deps({ mappings: m, progressWritable: false }))).toBeNull();
  });

  it('resolves the mapped estimate property to a number editor only when writable', () => {
    const m = mappings({ timeEstimateProperty: 'note.estimate' });
    expect(
      resolveCellEditor('note.estimate', deps({ mappings: m, estimateWritable: true })),
    ).toEqual({ kind: 'number' });
    expect(
      resolveCellEditor('note.estimate', deps({ mappings: m, estimateWritable: false })),
    ).toBeNull();
  });

  it('a non-writable mapped progress stays editor-less even when registered as a user field', () => {
    const d = deps({
      mappings: mappings({ progressProperty: 'note.done' }),
      progressWritable: false,
      taskNotesFieldType: registered('done', { type: 'number' }),
    });
    expect(resolveCellEditor('note.done', d)).toBeNull();
  });

  it('the mapped branch wins over a registered user field of another type', () => {
    const d = deps({
      mappings: mappings({ startProperty: 'note.start' }),
      taskNotesFieldType: registered('start', { type: 'text' }),
    });
    expect(resolveCellEditor('note.start', d)).toEqual({ kind: 'date', dateRole: 'start' });
  });
});

describe('resolveCellEditor — registered TaskNotes user fields', () => {
  it('resolves a date field to a date editor with NO date role (not cross-field validated)', () => {
    const d = deps({ taskNotesFieldType: registered('review', { type: 'date' }) });
    expect(resolveCellEditor('note.review', d)).toEqual({ kind: 'date' });
  });

  it('resolves a boolean field to a boolean editor', () => {
    const d = deps({ taskNotesFieldType: registered('approved', { type: 'boolean' }) });
    expect(resolveCellEditor('note.approved', d)).toEqual({ kind: 'boolean' });
  });

  it('resolves a number field to a number editor', () => {
    const d = deps({ taskNotesFieldType: registered('effort', { type: 'number' }) });
    expect(resolveCellEditor('note.effort', d)).toEqual({ kind: 'number' });
  });

  it('resolves a list field without a filter to a list editor', () => {
    const d = deps({ taskNotesFieldType: registered('tags2', { type: 'list' }) });
    expect(resolveCellEditor('note.tags2', d)).toEqual({ kind: 'list' });
  });

  it('resolves a list field with an autosuggest filter to a LIST-shaped suggest editor', () => {
    const filter = { includeFolders: ['People'] };
    const d = deps({
      taskNotesFieldType: registered('assignee', { type: 'list', autosuggestFilter: filter }),
    });
    expect(resolveCellEditor('note.assignee', d)).toEqual({
      kind: 'suggest',
      autosuggestFilter: filter,
      isList: true,
    });
  });

  it('resolves a text field without a filter to a text editor', () => {
    const d = deps({ taskNotesFieldType: registered('owner', { type: 'text' }) });
    expect(resolveCellEditor('note.owner', d)).toEqual({ kind: 'text' });
  });

  it('resolves a text field with an autosuggest filter to a single-value suggest editor', () => {
    const filter = { includeTags: ['#person'] };
    const d = deps({
      taskNotesFieldType: registered('owner', { type: 'text', autosuggestFilter: filter }),
    });
    expect(resolveCellEditor('note.owner', d)).toEqual({
      kind: 'suggest',
      autosuggestFilter: filter,
      isList: false,
    });
  });

  it('resolves an unknown field type to a plain text editor', () => {
    const d = deps({ taskNotesFieldType: registered('weird', { type: 'rating' }) });
    expect(resolveCellEditor('note.weird', d)).toEqual({ kind: 'text' });
  });

  it('resolves an unprefixed property id through the same rules', () => {
    const d = deps({ taskNotesFieldType: registered('effort', { type: 'number' }) });
    expect(resolveCellEditor('effort', d)).toEqual({ kind: 'number' });
  });
});

describe('resolveCellEditor — everything else', () => {
  it('resolves an unregistered, unmapped note.* property to no editor', () => {
    expect(resolveCellEditor('note.randomProp', deps())).toBeNull();
  });

  it('resolves an empty property id to no editor', () => {
    expect(resolveCellEditor('', deps())).toBeNull();
  });
});
