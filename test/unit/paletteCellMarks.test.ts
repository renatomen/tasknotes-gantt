import { describe, expect, it } from '@jest/globals';
import { cellRendersWithPaletteMarks } from '../../src/bases/paletteCellMarks';
import type { CellRender } from '../../src/bases/cellRender';
import type { TypedValue } from '../../src/bases/propertyValues';
import type { PriorityColor, StatusColor } from '../../src/datasource/types';

const progress = { role: 'status' as const, kind: 'progress' as const, progress: 1 / 2 };
const top = { role: 'priority' as const, kind: 'dot' as const, rank: 'top' as const };

const statuses: StatusColor[] = [
  { value: 'in-progress', color: '#0066cc', isCompleted: false, glyph: progress },
  { value: 'open', color: '#808080', isCompleted: false, icon: 'circle', glyph: { role: 'status', kind: 'open', progress: 0 } },
];
const priorities: PriorityColor[] = [
  { value: 'high', color: '#ff0000', glyph: top },
];

function renders(): Map<string, Record<string, CellRender>> {
  return new Map([
    [
      'Mid.md',
      {
        'note.status': { mode: 'text', text: 'in-progress' },
        'note.copy': { mode: 'text', text: 'in-progress' },
        'note.priority': { mode: 'text', text: 'high' },
      },
    ],
  ]);
}

function values(): Map<string, Record<string, TypedValue>> {
  return new Map([
    [
      'Mid.md',
      {
        'note.status': { kind: 'text', value: 'in-progress' },
        'note.copy': { kind: 'text', value: 'in-progress' },
        'note.priority': { kind: 'text', value: 'high' },
      },
    ],
  ]);
}

describe('cellRendersWithPaletteMarks', () => {
  it('marks the mapped status and priority cells and leaves another column with the same text unmarked', () => {
    const original = renders();
    const marked = cellRendersWithPaletteMarks(
      original,
      values(),
      { statusProperty: 'note.status', priorityProperty: 'note.priority' },
      { status: statuses, priority: priorities },
    );

    expect(marked.get('Mid.md')?.['note.status']).toEqual({
      mode: 'text',
      text: 'in-progress',
      paletteMark: { kind: 'glyph', glyph: progress, color: '#0066cc' },
    });
    expect(marked.get('Mid.md')?.['note.priority']).toEqual({
      mode: 'text',
      text: 'high',
      paletteMark: { kind: 'glyph', glyph: top, color: '#ff0000' },
    });
    expect(marked.get('Mid.md')?.['note.copy']).toEqual({ mode: 'text', text: 'in-progress' });
    expect(marked).not.toBe(original);
  });

  it('draws a configured icon instead of the glyph on the mapped status cell', () => {
    const cellRenders = new Map<string, Record<string, CellRender>>([
      ['Open.md', { 'note.status': { mode: 'text', text: 'open' } }],
    ]);
    const propertyValues = new Map<string, Record<string, TypedValue>>([
      ['Open.md', { 'note.status': { kind: 'text', value: 'open' } }],
    ]);

    const marked = cellRendersWithPaletteMarks(
      cellRenders,
      propertyValues,
      { statusProperty: 'note.status' },
      { status: statuses, priority: [] },
    );

    expect(marked.get('Open.md')?.['note.status']?.paletteMark).toEqual({
      kind: 'configured',
      iconName: 'circle',
      color: '#808080',
    });
  });

  it('returns the same map when palette entries carry no glyph', () => {
    const original = renders();
    const plain: StatusColor[] = [{ value: 'in-progress', color: '#0066cc', isCompleted: false }];
    const marked = cellRendersWithPaletteMarks(
      original,
      values(),
      { statusProperty: 'note.status' },
      { status: plain, priority: [] },
    );
    expect(marked).toBe(original);
  });

  it('falls back to currentColor for an unsafe palette color', () => {
    const cellRenders = new Map<string, Record<string, CellRender>>([
      ['Mid.md', { 'note.status': { mode: 'text', text: 'in-progress' } }],
    ]);
    const propertyValues = new Map<string, Record<string, TypedValue>>([
      ['Mid.md', { 'note.status': { kind: 'text', value: 'in-progress' } }],
    ]);
    const hostile: StatusColor[] = [
      {
        value: 'in-progress',
        color: 'red;position:fixed',
        isCompleted: false,
        glyph: progress,
      },
    ];

    const marked = cellRendersWithPaletteMarks(
      cellRenders,
      propertyValues,
      { statusProperty: 'note.status' },
      { status: hostile, priority: [] },
    );

    expect(marked.get('Mid.md')?.['note.status']?.paletteMark).toEqual({
      kind: 'glyph',
      glyph: progress,
      color: 'currentColor',
    });
  });
});
