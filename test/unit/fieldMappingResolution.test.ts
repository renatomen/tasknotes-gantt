/**
 * Field-mapping resolution: the view's mappings plus TaskNotes' field config
 * become the effective mappings, the date write targets, and which roles an
 * inline edit may persist.
 */

import { describe, expect, it } from '@jest/globals';
import { resolveFieldMappings } from '../../src/controller/fieldMappingResolution';
import { refusesGenericWrite } from '../../src/controller/fieldOwnership';
import { resolveModelConfig, type FieldMapping } from '@tasknotes/model';
import type { FieldMappings } from '../../src/datasource/fieldMappings';
import type { FieldConfig } from '../../src/datasource/types';

function mappings(partial: Partial<FieldMappings> = {}): FieldMappings {
  return {
    textProperty: 'file.name',
    startProperty: '',
    endProperty: '',
    progressProperty: '',
    progressMode: 'property',
    ...partial,
  };
}

function fieldConfig(partial: Partial<FieldConfig> = {}): FieldConfig {
  return {
    scheduledProp: 'scheduled',
    dueProp: 'due',
    dateFields: [],
    timeEstimateProp: null,
    statusProp: 'status',
    priorityProp: 'priority',
    ...partial,
  };
}

describe('resolveFieldMappings — status and priority', () => {
  it('resolves an unset status mapping to TaskNotes’ property and treats it as writable', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig());

    expect(resolved.mappings.statusProperty).toBe('note.status');
    expect(resolved.roleWritability.status).toBe(true);
  });

  it('treats a status mapping that names another property as read-only', () => {
    const resolved = resolveFieldMappings(
      mappings({ statusProperty: 'note.state' }),
      fieldConfig(),
    );

    expect(resolved.mappings.statusProperty).toBe('note.state');
    expect(resolved.roleWritability.status).toBe(false);
  });

  it('resolves an unset priority mapping to TaskNotes’ property and treats it as writable', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig());

    expect(resolved.mappings.priorityProperty).toBe('note.priority');
    expect(resolved.roleWritability.priority).toBe(true);
  });

  it('treats a priority mapping that names another property as read-only', () => {
    const resolved = resolveFieldMappings(
      mappings({ priorityProperty: 'note.urgency' }),
      fieldConfig(),
    );

    expect(resolved.mappings.priorityProperty).toBe('note.urgency');
    expect(resolved.roleWritability.priority).toBe(false);
  });

  it('keeps an explicit mapping that names TaskNotes’ own property, and it stays writable', () => {
    const resolved = resolveFieldMappings(
      mappings({ statusProperty: 'note.status', priorityProperty: 'note.priority' }),
      fieldConfig(),
    );

    expect(resolved.mappings.statusProperty).toBe('note.status');
    expect(resolved.mappings.priorityProperty).toBe('note.priority');
    expect(resolved.roleWritability.status).toBe(true);
    expect(resolved.roleWritability.priority).toBe(true);
  });

  it('leaves priority unset when TaskNotes configures no priority property', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig({ priorityProp: null }));

    expect(resolved.mappings.priorityProperty).toBeUndefined();
    expect(resolved.roleWritability.priority).toBe(false);
  });
});

describe('resolveFieldMappings — assignees', () => {
  it('resolves an unset assignees mapping to TaskNotes’ property and treats it as writable', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig({ assigneesProp: 'assignee' }));

    expect(resolved.mappings.assigneesProperty).toBe('note.assignee');
    expect(resolved.roleWritability.assignees).toBe(true);
  });

  it('keeps an explicit mapping to TaskNotes’ own assignees property writable', () => {
    const resolved = resolveFieldMappings(
      mappings({ assigneesProperty: 'note.assignee' }),
      fieldConfig({ assigneesProp: 'assignee' }),
    );

    expect(resolved.mappings.assigneesProperty).toBe('note.assignee');
    expect(resolved.roleWritability.assignees).toBe(true);
  });

  it('treats an assignees mapping that names another property as read-only', () => {
    const resolved = resolveFieldMappings(
      mappings({ assigneesProperty: 'note.people' }),
      fieldConfig({ assigneesProp: 'assignee' }),
    );

    expect(resolved.mappings.assigneesProperty).toBe('note.people');
    expect(resolved.roleWritability.assignees).toBe(false);
  });

  it('claims no assignees column when TaskNotes has no Assignees field', () => {
    const resolved = resolveFieldMappings(
      mappings({ assigneesProperty: 'note.assignee' }),
      fieldConfig({ assigneesProp: null }),
    );

    expect(resolved.mappings.assigneesProperty).toBeUndefined();
    expect(resolved.roleWritability.assignees).toBe(false);
  });
});

describe('resolveFieldMappings — start and end', () => {
  it('resolves unset start and end to the scheduled and due write targets', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig());

    expect(resolved.mappings.startProperty).toBe('note.scheduled');
    expect(resolved.mappings.endProperty).toBe('note.due');
    expect(resolved.startWriteTarget).toEqual({ kind: 'scheduled' });
    expect(resolved.endWriteTarget).toEqual({ kind: 'due' });
    expect(resolved.dateMappingInfo).toEqual({
      startInvalid: false,
      endInvalid: false,
      startReadProp: 'scheduled',
      endReadProp: 'due',
    });
  });

  it('keeps a custom date field as the read property and the user-field write target', () => {
    const resolved = resolveFieldMappings(
      mappings({ startProperty: 'note.start', endProperty: 'note.due' }),
      fieldConfig({
        dateFields: [{ key: 'start', id: 'uf_start', displayName: 'Start' }],
      }),
    );

    expect(resolved.mappings.startProperty).toBe('note.start');
    expect(resolved.startWriteTarget).toEqual({ kind: 'userField', key: 'start', id: 'uf_start' });
    expect(resolved.dateMappingInfo.startInvalid).toBe(false);
    expect(resolved.dateMappingInfo.startReadProp).toBe('start');
    expect(resolved.endWriteTarget).toEqual({ kind: 'due' });
  });

  it('flags an invalid start mapping and falls back to the scheduled target', () => {
    const resolved = resolveFieldMappings(
      mappings({ startProperty: 'note.notes' }),
      fieldConfig(),
    );

    expect(resolved.mappings.startProperty).toBe('note.scheduled');
    expect(resolved.startWriteTarget).toEqual({ kind: 'scheduled' });
    expect(resolved.dateMappingInfo.startInvalid).toBe(true);
    expect(resolved.dateMappingInfo.startReadProp).toBe('scheduled');
  });
});

describe('resolveFieldMappings — no TaskNotes field config', () => {
  it('passes the view mappings through and marks no role writable', () => {
    const view = mappings({ statusProperty: 'note.state', calendarProperty: 'note.cal' });

    const resolved = resolveFieldMappings(view, null);

    expect(resolved.mappings).toEqual(view);
    expect(resolved.mappings).not.toBe(view);
    expect(resolved.startWriteTarget).toBeNull();
    expect(resolved.endWriteTarget).toBeNull();
    expect(resolved.dateMappingInfo).toEqual({
      startInvalid: false,
      endInvalid: false,
      startReadProp: null,
      endReadProp: null,
    });
    expect(resolved.roleWritability.status).toBe(false);
    expect(resolved.roleWritability.priority).toBe(false);
    expect(resolved.roleWritability.assignees).toBe(false);
    expect(resolved.roleWritability.ownership?.known).toBe(false);
    expect(refusesGenericWrite('client', resolved.roleWritability.ownership!)).toBe(true);
  });
});

describe('resolveFieldMappings — owned fields', () => {
  it('refuses the mapped Attachments property and allows an unrelated user field', () => {
    const resolved = resolveFieldMappings(
      mappings(),
      fieldConfig({
        fieldMapping: {
          attachments: 'files',
          assignees: 'assignee',
          due: 'due',
          title: 'title',
        },
      }),
    );
    const ownership = resolved.roleWritability.ownership;
    if (!ownership) throw new Error('expected ownership');

    expect(ownership.known).toBe(true);
    expect(refusesGenericWrite('files', ownership)).toBe(true);
    expect(refusesGenericWrite('recurrence_original_date', ownership)).toBe(false);
    expect(refusesGenericWrite('client', ownership)).toBe(false);
    expect(refusesGenericWrite('assignees', ownership)).toBe(true);
  });

  it('refuses every generic write when a read found no field mapping', () => {
    const resolved = resolveFieldMappings(mappings(), fieldConfig({ fieldMapping: null }));
    const ownership = resolved.roleWritability.ownership;
    if (!ownership) throw new Error('expected ownership');

    expect(ownership.known).toBe(false);
    expect(refusesGenericWrite('client', ownership)).toBe(true);
    expect(refusesGenericWrite('due', ownership)).toBe(true);
  });

  it('owns recurrence_original_date when the reported mapping fills that default', () => {
    // Stored settings can omit a member the type requires. The resolver fills it.
    const reported = resolveModelConfig({
      fieldMapping: { title: 'title', due: 'due' } as FieldMapping,
    }).fieldMapping;
    const mapping: Record<string, string> = {};
    for (const [member, value] of Object.entries(reported)) {
      if (typeof value === 'string') mapping[member] = value;
    }
    const ownership = resolveFieldMappings(mappings(), fieldConfig({ fieldMapping: mapping }))
      .roleWritability.ownership;
    if (!ownership) throw new Error('expected ownership');

    expect(mapping.recurrenceOriginalDate).toBe('recurrence_original_date');
    expect(refusesGenericWrite('recurrence_original_date', ownership)).toBe(true);
  });

  it('allows a user field named assignees when the mapping has no Assignees field', () => {
    const resolved = resolveFieldMappings(
      mappings(),
      fieldConfig({ fieldMapping: { title: 'title', due: 'due' } }),
    );
    const ownership = resolved.roleWritability.ownership;
    if (!ownership) throw new Error('expected ownership');

    expect(refusesGenericWrite('assignees', ownership)).toBe(false);
  });
});
