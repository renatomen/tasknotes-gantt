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
  isSafeColor,
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

describe('isSafeColor', () => {
  it('accepts valid hex (3/4/6/8), rgb()/hsl() forms, and named colors', () => {
    for (const c of ['#fff', '#ffff', '#ff8800', '#ff8800cc', 'red', 'rebeccapurple', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(1, 2%, 3%)']) {
      expect(isSafeColor(c)).toBe(true);
    }
  });

  it('rejects invalid hex lengths (5/7) that would silently drop the declaration', () => {
    expect(isSafeColor('#12345')).toBe(false);
    expect(isSafeColor('#1234567')).toBe(false);
  });

  it('rejects CSS-wide keywords that render an invisible bar', () => {
    for (const c of ['transparent', 'inherit', 'currentColor', 'initial', 'unset', 'revert', 'none']) {
      expect(isSafeColor(c)).toBe(false);
    }
  });

  it('rejects injection payloads, a trailing-newline bypass, and empty values', () => {
    // The `$` anchor is end-of-string (no `m` flag), so a trailing newline does NOT slip through.
    for (const c of ['red; } body {', '#fff}.x{}', 'rgb(0,0,0);x:1', 'red\n', 'url(x)', '', null, undefined]) {
      expect(isSafeColor(c as string)).toBe(false);
    }
  });
});

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
    expect(css).toContain(`.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')} { background-color: #f8312f !important;`);
    expect(css).toContain('background-color: #00d26a !important;');
    expect(css).toContain('text-shadow:'); // readable label on the fill
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
    expect(css).toContain('z-index: 1;'); // above SVAR's progress fill, below .wx-content
    expect(css).toContain('border-top-left-radius:'); // conforms to the bar's rounded left corner
    expect(css).not.toContain('#f8312f !important'); // strip accent is not a !important fill
    // Strip mode widens the content inset so the chip/text clears the strip.
    expect(css).toContain('.og-bases-gantt .wx-bar .wx-content { padding-left: 10px !important; }');
    // Strip body: readable text (!important beats SVAR's scoped white) + a visible,
    // theme-independent outline (color-mix guarantees a delta in low-contrast themes).
    expect(css).toContain('color: var(--text-normal) !important');
    expect(css).toContain('border: 1px solid color-mix(in srgb, var(--text-normal) 38%, var(--background-primary)) !important');
  });

  it('fill/priority and strip/priority key on the priority palette', () => {
    const fill = buildTreatmentStyle({ mode: 'fill', source: 'priority', palettes, instances: [inst(null, 'high')] });
    expect(fill).toContain(`.wx-bar.${prioritySlug('high')} { background-color: #ff0000 !important;`);
    const strip = buildTreatmentStyle({ mode: 'strip', source: 'priority', palettes, instances: [inst(null, 'high')] });
    expect(strip).toContain(`.wx-bar.${prioritySlug('high')}::before`);
  });

  it('theme/fill: uses the theme accent (child) + a tonal-shifted accent (parent), not fixed hues', () => {
    const css = buildTreatmentStyle({ mode: 'fill', source: 'theme', palettes: { status: [], priority: [] }, instances: [] });
    expect(css).toContain('background-color: var(--interactive-accent) !important;'); // child = raw theme accent
    expect(css).toContain(
      `.wx-bar.${PARENT_ROLE_CLASS} { background-color: color-mix(in srgb, var(--interactive-accent), var(--text-normal) 30%) !important;`,
    ); // parent = more-contrasting tone of the SAME accent
    expect(css).not.toContain('--color-'); // never a fixed named-palette hue
  });

  it('theme/strip: emits a neutral body + --color-* ::before rules', () => {
    const css = buildTreatmentStyle({ mode: 'strip', source: 'theme', palettes, instances: [] });
    // Body is mixed a bit off the background so it stays visible in low-contrast themes.
    expect(css).toContain('background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important;');
    expect(css).toContain(
      `.wx-bar.${PARENT_ROLE_CLASS}::before { background-color: color-mix(in srgb, var(--interactive-accent), var(--text-normal) 30%); }`,
    );
    // Progress shifts the neutral body, not the accent strip.
    expect(css).toContain('.wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }');
    expect(css).not.toContain('.wx-progress-percent { background-color: color-mix(in srgb, var(--interactive-accent)');
  });

  it('default/strip: parent body is a higher-contrast neutral than the child body (hierarchy cue)', () => {
    const css = buildTreatmentStyle({ mode: 'strip', source: 'default', palettes, instances: [] });
    // Child/base neutral body (16% toward text)...
    expect(css).toContain('.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important;');
    // ...and a more prominent parent body override (30%), contrast-only (no opacity).
    expect(css).toContain(
      `.og-bases-gantt .wx-bar.${PARENT_ROLE_CLASS} { background-color: color-mix(in srgb, var(--text-normal) 30%, var(--background-primary)) !important; }`,
    );
    expect(css).not.toContain('opacity');
  });

  it('default/fill: emits fixed green-parent / blue-child role rules (no palette)', () => {
    const css = buildTreatmentStyle({ mode: 'fill', source: 'default', palettes, instances: [inst('11🟥Active = Now')] });
    expect(css).toContain('background-color: #1f6feb !important;'); // child (blue)
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: #2ea043 !important;`); // parent (green)
    expect(css).not.toContain('#f8312f'); // does not consult the status palette
  });

  it('fill mode: progress is a contrasting shift of the bar fill accent (not SVAR blue)', () => {
    const fill = buildTreatmentStyle({ mode: 'fill', source: 'status', palettes, instances: [inst('11🟥Active = Now')] });
    expect(fill).toContain(
      `.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')} .wx-progress-percent { background-color: color-mix(in srgb, #f8312f, var(--text-normal) 30%) !important; }`,
    );
  });

  it('strip mode: progress shifts the NEUTRAL bar body, not the strip accent', () => {
    const strip = buildTreatmentStyle({ mode: 'strip', source: 'status', palettes, instances: [inst('11🟥Active = Now')] });
    // Progress is a tonal shift of the shared neutral body...
    expect(strip).toContain(
      '.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }',
    );
    // ...never the strip accent color extended rightward.
    expect(strip).not.toContain('color-mix(in srgb, #f8312f');
  });

  it('default/fill: progress follows the role colors (contrasted child + parent)', () => {
    const css = buildTreatmentStyle({ mode: 'fill', source: 'default', palettes, instances: [] });
    expect(css).toContain('.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, #1f6feb, var(--text-normal) 30%) !important; }');
    expect(css).toContain(
      `.og-bases-gantt .wx-bar.${PARENT_ROLE_CLASS} .wx-progress-percent { background-color: color-mix(in srgb, #2ea043, var(--text-normal) 30%) !important; }`,
    );
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

  it('drops a CSS-keyword color (transparent) that would render an invisible bar', () => {
    const css = buildTreatmentStyle({
      mode: 'fill',
      source: 'status',
      palettes: { status: [{ value: 'x', color: 'transparent', isCompleted: false }], priority: [] },
      instances: [inst('x')],
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

  it('falls back to currentColor for a CSS-keyword color (transparent)', () => {
    const p: Palettes = { status: [{ value: 'x', color: 'transparent', isCompleted: false }], priority: [] };
    expect(resolveIconSpec('status', inst('x'), p)).toEqual({ kind: 'status', color: 'currentColor' });
  });
});
