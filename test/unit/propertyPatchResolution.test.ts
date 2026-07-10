/**
 * propertyPatchResolution unit tests — pure resolution of an edited property id
 * + raw value into the TaskPatch a cell edit persists.
 *
 * - each mapped branch (start/end/text/status/progress/estimate) routes to its
 *   dedicated patch member
 * - each narrower rejects a wrong-typed value (TypeError)
 * - file./formula. prefixed and unresolvable ids are refused (TypeError)
 * - progress/estimate fail CLOSED when not writable (no bare patch that the
 *   source would silently drop)
 * - fieldWrite refuses canonical TaskNotes TaskInfo keys (TypeError)
 * - a Date fieldWrite value serializes as local YYYY-MM-DD; null clears; an
 *   empty list passes as []
 */

import { describe, it, expect } from '@jest/globals';
import { resolvePropertyPatch } from '../../src/controller/propertyPatchResolution';
import type { PropertyPatchOptions } from '../../src/controller/propertyPatchResolution';
import type { FieldMappings } from '../../src/bases/types/field-mapping';

function makeOptions(
  mappings: Partial<FieldMappings> = {},
  flags: { progressWritable?: boolean; estimateWritable?: boolean } = {},
): PropertyPatchOptions {
  return {
    mappings: {
      textProperty: '',
      startProperty: '',
      endProperty: '',
      progressProperty: '',
      ...mappings,
    },
    progressWritable: flags.progressWritable ?? true,
    estimateWritable: flags.estimateWritable ?? true,
  };
}

describe('resolvePropertyPatch — mapped branches', () => {
  it('routes the mapped start property to a start date patch', () => {
    const out = resolvePropertyPatch('note.begin', new Date(2026, 5, 1), makeOptions({ startProperty: 'note.begin' }));
    expect(out).toEqual({ start: new Date(2026, 5, 1) });
  });

  it('routes the mapped end property to an end date patch', () => {
    const out = resolvePropertyPatch('note.finish', new Date(2026, 6, 4), makeOptions({ endProperty: 'note.finish' }));
    expect(out).toEqual({ end: new Date(2026, 6, 4) });
  });

  it('routes a null on a mapped date property to a date clear', () => {
    const out = resolvePropertyPatch('note.begin', null, makeOptions({ startProperty: 'note.begin' }));
    expect(out).toEqual({ start: null });
  });

  it('routes the mapped text property to a text patch', () => {
    const out = resolvePropertyPatch('note.name', 'Renamed', makeOptions({ textProperty: 'note.name' }));
    expect(out).toEqual({ text: 'Renamed' });
  });

  it('routes the mapped status property to a status patch', () => {
    const out = resolvePropertyPatch('note.state', 'done', makeOptions({ statusProperty: 'note.state' }));
    expect(out).toEqual({ status: 'done' });
  });

  it('routes the mapped progress property to a progress patch when writable', () => {
    const out = resolvePropertyPatch('note.percent', 80, makeOptions({ progressProperty: 'note.percent' }, { progressWritable: true }));
    expect(out).toEqual({ progress: 80 });
  });

  it('routes the mapped estimate property to an estimate patch when writable', () => {
    const out = resolvePropertyPatch('note.est', 4320, makeOptions({ timeEstimateProperty: 'note.est' }, { estimateWritable: true }));
    expect(out).toEqual({ estimate: 4320 });
  });
});

describe('resolvePropertyPatch — narrower rejections', () => {
  it('rejects a non-Date value on a mapped date property', () => {
    expect(() =>
      resolvePropertyPatch('note.begin', 'tomorrow', makeOptions({ startProperty: 'note.begin' })),
    ).toThrow(TypeError);
  });

  it('rejects an invalid Date on a mapped date property', () => {
    expect(() =>
      resolvePropertyPatch('note.begin', new Date('nonsense'), makeOptions({ startProperty: 'note.begin' })),
    ).toThrow(TypeError);
  });

  it('rejects a non-string value on the mapped text property', () => {
    expect(() =>
      resolvePropertyPatch('note.name', 42, makeOptions({ textProperty: 'note.name' })),
    ).toThrow(TypeError);
  });

  it('rejects a non-string value on the mapped status property', () => {
    expect(() =>
      resolvePropertyPatch('note.state', 42, makeOptions({ statusProperty: 'note.state' })),
    ).toThrow(TypeError);
  });

  it('rejects a non-numeric value on the mapped progress property', () => {
    expect(() =>
      resolvePropertyPatch('note.percent', '80', makeOptions({ progressProperty: 'note.percent' })),
    ).toThrow(TypeError);
  });

  it('rejects a non-finite value on the mapped estimate property', () => {
    expect(() =>
      resolvePropertyPatch('note.est', Number.NaN, makeOptions({ timeEstimateProperty: 'note.est' })),
    ).toThrow(TypeError);
  });
});

describe('resolvePropertyPatch — property-id refusals', () => {
  it('refuses a file.-prefixed id', () => {
    expect(() => resolvePropertyPatch('file.name', 'x', makeOptions())).toThrow(TypeError);
  });

  it('refuses a formula.-prefixed id', () => {
    expect(() => resolvePropertyPatch('formula.total', 'x', makeOptions())).toThrow(TypeError);
  });

  it('refuses an unresolvable id', () => {
    expect(() => resolvePropertyPatch('note.', 'x', makeOptions())).toThrow(TypeError);
  });
});

describe('resolvePropertyPatch — fail-closed progress/estimate', () => {
  it('throws (no bare progress patch) when the progress property is not writable', () => {
    expect(() =>
      resolvePropertyPatch('note.percent', 80, makeOptions({ progressProperty: 'note.percent' }, { progressWritable: false })),
    ).toThrow(/not writable/);
  });

  it('throws (no bare estimate patch) when the estimate property is not writable', () => {
    expect(() =>
      resolvePropertyPatch('note.est', 4320, makeOptions({ timeEstimateProperty: 'note.est' }, { estimateWritable: false })),
    ).toThrow(/not writable/);
  });
});

describe('resolvePropertyPatch — canonical TaskNotes key refusal', () => {
  it.each(['due', 'title', 'details', 'contexts'])(
    'refuses a fieldWrite to the canonical TaskInfo key %s',
    (key) => {
      expect(() => resolvePropertyPatch(`note.${key}`, 'x', makeOptions())).toThrow(TypeError);
    },
  );
});

describe('resolvePropertyPatch — generic fieldWrite', () => {
  it('routes an unmapped property to a fieldWrite by bare key', () => {
    const out = resolvePropertyPatch('note.effort', 'high', makeOptions());
    expect(out).toEqual({ fieldWrite: { key: 'effort', value: 'high' } });
  });

  it('serializes a Date fieldWrite value as local YYYY-MM-DD, never an ISO timestamp', () => {
    const out = resolvePropertyPatch('note.reviewed', new Date(2026, 5, 1, 14, 30), makeOptions());
    expect(out).toEqual({ fieldWrite: { key: 'reviewed', value: '2026-06-01' } });
  });

  it('rejects an invalid Date fieldWrite value', () => {
    expect(() => resolvePropertyPatch('note.reviewed', new Date('nonsense'), makeOptions())).toThrow(TypeError);
  });

  it('passes a null through the fieldWrite (property clear)', () => {
    const out = resolvePropertyPatch('note.effort', null, makeOptions());
    expect(out).toEqual({ fieldWrite: { key: 'effort', value: null } });
  });

  it('passes an empty list through the fieldWrite as []', () => {
    const out = resolvePropertyPatch('note.labels', [], makeOptions());
    expect(out).toEqual({ fieldWrite: { key: 'labels', value: [] } });
  });
});
