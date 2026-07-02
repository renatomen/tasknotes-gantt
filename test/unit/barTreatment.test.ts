/**
 * barTreatment unit tests (U3).
 *
 * Pure helpers for per-view bar color/icon treatments — the full Mode × Source
 * matrix plus the icon-spec resolver and slug safety.
 */

import { describe, it, expect } from '@jest/globals';
import {
  statusSlug,
  prioritySlug,
  resolveTreatmentClass,
  treatmentClassRegistry,
  buildTreatmentStyle,
  resolveIconSpec,
  PARENT_ROLE_CLASS,
  STATUS_CLASS_PREFIX,
  PRIORITY_CLASS_PREFIX,
  type Palettes,
} from '../../src/bases/barTreatment';
import type { PriorityColor, StatusColor } from '../../src/datasource/types';

const statusColors: StatusColor[] = [
  { value: '11🟥Active = Now', color: '#f8312f', isCompleted: false, icon: 'circle' },
  { value: '41🟩Done = Recent', color: '#00d26a', isCompleted: true },
  { value: 'Unused', color: '#123456', isCompleted: false },
];
const priorityColors: PriorityColor[] = [
  { value: 'high', color: '#ff0000', icon: 'flag' },
  { value: 'low', color: '#00aaff' },
];
const palettes: Palettes = { status: statusColors, priority: priorityColors };

const inst = (status: string | null, priority: string | null = null) => ({ status, priority });

describe('slugs', () => {
  it('use distinct prefixes for status vs priority', () => {
    expect(statusSlug('high').startsWith(STATUS_CLASS_PREFIX)).toBe(true);
    expect(prioritySlug('high').startsWith(PRIORITY_CLASS_PREFIX)).toBe(true);
    expect(statusSlug('high')).not.toBe(prioritySlug('high'));
  });

  it('are CSS-safe and stable for emoji/space values', () => {
    const s = statusSlug('11🟥Active = Now');
    expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(statusSlug('11🟥Active = Now')).toBe(s);
  });

  it('do not collide for distinct values whose readable parts coincide', () => {
    expect(statusSlug('🟥Active')).not.toBe(statusSlug('🟧Active'));
  });
});

describe('resolveTreatmentClass', () => {
  it('returns the status slug for source=status when the value has a safe color', () => {
    expect(resolveTreatmentClass('status', inst('11🟥Active = Now'), false, palettes)).toBe(
      statusSlug('11🟥Active = Now'),
    );
  });

  it('returns the priority slug for source=priority', () => {
    expect(resolveTreatmentClass('priority', inst(null, 'high'), false, palettes)).toBe(
      prioritySlug('high'),
    );
  });

  it('returns null when the value is absent from the palette', () => {
    expect(resolveTreatmentClass('status', inst('nope'), false, palettes)).toBeNull();
    expect(resolveTreatmentClass('priority', inst(null, 'nope'), false, palettes)).toBeNull();
  });

  it('returns og-parent only for parents in theme mode, null for children', () => {
    expect(resolveTreatmentClass('theme', inst('x'), true, palettes)).toBe(PARENT_ROLE_CLASS);
    expect(resolveTreatmentClass('theme', inst('x'), false, palettes)).toBeNull();
  });

  it('returns og-parent for a parent and null for a child in default/theme (role sources)', () => {
    expect(resolveTreatmentClass('default', inst('x'), true, palettes)).toBe(PARENT_ROLE_CLASS);
    expect(resolveTreatmentClass('default', inst('x'), false, palettes)).toBeNull();
  });
});

describe('treatmentClassRegistry', () => {
  it('includes og-parent plus every safe status and priority slug', () => {
    const reg = treatmentClassRegistry(palettes);
    expect(reg).toContain(PARENT_ROLE_CLASS);
    expect(reg).toContain(statusSlug('11🟥Active = Now'));
    expect(reg).toContain(prioritySlug('high'));
    expect(reg).toContain(prioritySlug('low'));
  });

  it('omits palette values with an unsafe color (status and priority)', () => {
    const reg = treatmentClassRegistry({
      status: [{ value: 'Evil', color: 'red; } body {', isCompleted: false }],
      priority: [{ value: 'BadPrio', color: 'blue; } body {' }],
    });
    expect(reg).toEqual([PARENT_ROLE_CLASS]);
  });
});

describe('buildTreatmentStyle', () => {
  it('fill/status: emits a scoped !important background per present, safe status', () => {
    const css = buildTreatmentStyle({
      mode: 'fill',
      source: 'status',
      palettes,
      instances: [inst('11🟥Active = Now'), inst('41🟩Done = Recent')],
    });
    expect(css).toContain(`.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')} { background-color: #f8312f !important; }`);
    expect(css).toContain('background-color: #00d26a !important;');
    expect(css).not.toContain('#123456'); // Unused: not present
    expect(css).not.toContain('padding-left'); // no strip in fill mode → no extra inset
  });

  it('strip/status: emits ::before accent rules, not background fills', () => {
    const css = buildTreatmentStyle({
      mode: 'strip',
      source: 'status',
      palettes,
      instances: [inst('11🟥Active = Now')],
    });
    expect(css).toContain(`.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')}::before`);
    expect(css).toContain('width: 6px;');
    expect(css).toContain('background-color: #f8312f;');
    expect(css).not.toContain('#f8312f !important'); // strip accent is not a !important fill
    // Strip mode widens the content inset so the chip/text clears the strip.
    expect(css).toContain('.og-bases-gantt .wx-bar .wx-content { padding-left: 10px !important; }');
  });

  it('fill/priority and strip/priority key on the priority palette', () => {
    const fill = buildTreatmentStyle({ mode: 'fill', source: 'priority', palettes, instances: [inst(null, 'high')] });
    expect(fill).toContain(`.wx-bar.${prioritySlug('high')} { background-color: #ff0000 !important; }`);
    const strip = buildTreatmentStyle({ mode: 'strip', source: 'priority', palettes, instances: [inst(null, 'high')] });
    expect(strip).toContain(`.wx-bar.${prioritySlug('high')}::before`);
  });

  it('theme/fill: emits parent + child adaptive --color-* role rules with no palette', () => {
    const css = buildTreatmentStyle({ mode: 'fill', source: 'theme', palettes: { status: [], priority: [] }, instances: [] });
    expect(css).toContain('background-color: var(--color-blue) !important;'); // child
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: var(--color-green) !important;`); // parent
  });

  it('theme/strip: emits a neutral body + --color-* ::before rules', () => {
    const css = buildTreatmentStyle({ mode: 'strip', source: 'theme', palettes, instances: [] });
    expect(css).toContain('background-color: var(--background-secondary) !important;');
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS}::before { background-color: var(--color-green); }`);
  });

  it('default/fill: emits fixed green-parent / blue-child role rules (no palette)', () => {
    const css = buildTreatmentStyle({ mode: 'fill', source: 'default', palettes, instances: [inst('11🟥Active = Now')] });
    expect(css).toContain('background-color: #1f6feb !important;'); // child (blue)
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: #2ea043 !important;`); // parent (green)
    expect(css).not.toContain('#f8312f'); // does not consult the status palette
  });

  it('degrades to empty when the source palette is empty', () => {
    expect(
      buildTreatmentStyle({ mode: 'fill', source: 'status', palettes: { status: [], priority: [] }, instances: [inst('x')] }),
    ).toBe('');
  });

  it('dedupes a value present on multiple instances', () => {
    const css = buildTreatmentStyle({
      mode: 'fill',
      source: 'status',
      palettes,
      instances: [inst('11🟥Active = Now'), inst('11🟥Active = Now')],
    });
    expect(css.match(/background-color: #f8312f !important;/g)).toHaveLength(1);
  });

  it('skips an unsafe palette color (CSS-injection guard)', () => {
    const css = buildTreatmentStyle({
      mode: 'fill',
      source: 'status',
      palettes: { status: [{ value: 'Evil', color: 'red; } body { display: none', isCompleted: false }], priority: [] },
      instances: [inst('Evil')],
    });
    expect(css).toBe('');
  });
});

describe('resolveIconSpec', () => {
  it('returns kind + glyph + color when the status config has an icon', () => {
    expect(resolveIconSpec('status', inst('11🟥Active = Now'), palettes)).toEqual({
      kind: 'status',
      iconName: 'circle',
      color: '#f8312f',
    });
  });

  it('returns kind + color (no icon → ring/dot) when the value has no configured icon', () => {
    expect(resolveIconSpec('status', inst('41🟩Done = Recent'), palettes)).toEqual({ kind: 'status', color: '#00d26a' });
    expect(resolveIconSpec('priority', inst(null, 'low'), palettes)).toEqual({ kind: 'priority', color: '#00aaff' });
  });

  it('returns priority kind + glyph for source=priority', () => {
    expect(resolveIconSpec('priority', inst(null, 'high'), palettes)).toEqual({ kind: 'priority', iconName: 'flag', color: '#ff0000' });
  });

  it('returns null when the value is absent from the palette', () => {
    expect(resolveIconSpec('status', inst('nope'), palettes)).toBeNull();
    expect(resolveIconSpec('priority', inst(null, null), palettes)).toBeNull();
  });

  it('returns null when the icon source is none', () => {
    expect(resolveIconSpec('none', inst('11🟥Active = Now', 'high'), palettes)).toBeNull();
  });

  it('falls back to currentColor for an unsafe palette color (CSS-injection guard)', () => {
    const hostile: Palettes = {
      status: [{ value: 'evil', color: 'red;position:fixed;inset:0;z-index:99999', isCompleted: false }],
      priority: [],
    };
    expect(resolveIconSpec('status', inst('evil'), hostile)).toEqual({ kind: 'status', color: 'currentColor' });
  });
});
