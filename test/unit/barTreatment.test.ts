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
  calendarSlug,
  resolveTreatmentClass,
  treatmentClassRegistry,
  buildTreatmentStyle,
  resolveIconSpec,
  isSafeColor,
  PARENT_ROLE_CLASS,
  STATUS_CLASS_PREFIX,
  PRIORITY_CLASS_PREFIX,
  type Palettes,
  type TreatmentStyleInput,
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

// Every treatment test builds under the legacy `.og-bases-gantt` root so the
// golden-master fidelity strings stay byte-identical; the scope-parameterization
// itself is guarded by its own test below.
const styleFor = (input: Omit<TreatmentStyleInput, 'scope'>): string =>
  buildTreatmentStyle({ ...input, scope: '.og-bases-gantt' });

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
  it('returns the fill-channel status slug for fill=status, strip=none', () => {
    expect(resolveTreatmentClass({ fillSource: 'status', stripSource: 'none', instance: inst('11🟥Active = Now'), isParent: false, palettes })).toEqual([
      statusSlug('11🟥Active = Now'),
    ]);
  });

  it('returns the strip-channel priority slug for fill=none, strip=priority', () => {
    expect(resolveTreatmentClass({ fillSource: 'none', stripSource: 'priority', instance: inst(null, 'high'), isParent: false, palettes })).toEqual([
      prioritySlug('high'),
    ]);
  });

  it('returns BOTH classes when fill and strip resolve to distinct values', () => {
    // Fill by status, strip by priority — the bar carries both, fill class first.
    expect(
      resolveTreatmentClass({ fillSource: 'status', stripSource: 'priority', instance: inst('11🟥Active = Now', 'high'), isParent: false, palettes }),
    ).toEqual([statusSlug('11🟥Active = Now'), prioritySlug('high')]);
  });

  it('dedupes to a single class when both channels resolve to the same class (redundant combo)', () => {
    expect(
      resolveTreatmentClass({ fillSource: 'status', stripSource: 'status', instance: inst('11🟥Active = Now'), isParent: false, palettes }),
    ).toEqual([statusSlug('11🟥Active = Now')]);
  });

  it('returns an empty array when both channels are none', () => {
    expect(resolveTreatmentClass({ fillSource: 'none', stripSource: 'none', instance: inst('11🟥Active = Now', 'high'), isParent: false, palettes })).toEqual([]);
    expect(resolveTreatmentClass({ fillSource: 'none', stripSource: 'none', instance: inst('x'), isParent: true, palettes })).toEqual([]);
  });

  it('omits a channel whose value is absent from the palette', () => {
    expect(resolveTreatmentClass({ fillSource: 'status', stripSource: 'none', instance: inst('nope'), isParent: false, palettes })).toEqual([]);
    expect(resolveTreatmentClass({ fillSource: 'none', stripSource: 'priority', instance: inst(null, 'nope'), isParent: false, palettes })).toEqual([]);
  });

  it('carries og-parent once for parents in a role source (default/theme), nothing for children', () => {
    expect(resolveTreatmentClass({ fillSource: 'theme', stripSource: 'none', instance: inst('x'), isParent: true, palettes })).toEqual([PARENT_ROLE_CLASS]);
    expect(resolveTreatmentClass({ fillSource: 'theme', stripSource: 'none', instance: inst('x'), isParent: false, palettes })).toEqual([]);
    expect(resolveTreatmentClass({ fillSource: 'default', stripSource: 'none', instance: inst('x'), isParent: true, palettes })).toEqual([PARENT_ROLE_CLASS]);
    expect(resolveTreatmentClass({ fillSource: 'default', stripSource: 'none', instance: inst('x'), isParent: false, palettes })).toEqual([]);
    // A parent under default fill + theme strip dedupes the shared og-parent role class.
    expect(resolveTreatmentClass({ fillSource: 'default', stripSource: 'theme', instance: inst('x'), isParent: true, palettes })).toEqual([PARENT_ROLE_CLASS]);
  });

  it('degrades status/priority with an EMPTY palette to the default role (og-parent for parents)', () => {
    const empty: Palettes = { status: [], priority: [] };
    expect(resolveTreatmentClass({ fillSource: 'status', stripSource: 'none', instance: inst('x'), isParent: true, palettes: empty })).toEqual([PARENT_ROLE_CLASS]);
    expect(resolveTreatmentClass({ fillSource: 'status', stripSource: 'none', instance: inst('x'), isParent: false, palettes: empty })).toEqual([]);
    expect(resolveTreatmentClass({ fillSource: 'none', stripSource: 'priority', instance: inst(null, 'x'), isParent: true, palettes: empty })).toEqual([PARENT_ROLE_CLASS]);
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
  it('fill=status/strip=none: emits a scoped !important background per present, safe status', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'none',
      palettes,
      instances: [inst('11🟥Active = Now'), inst('41🟩Done = Recent')],
    });
    expect(css).toContain(`.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')} { background-color: #f8312f !important;`);
    expect(css).toContain('background-color: #00d26a !important;');
    // Ghost pieces re-read the fill through this property (a wx-split bar's own
    // background is transparent, so without it a stretched bar loses its colour).
    expect(css).toContain('--og-ghost-fill: #f8312f;');
    expect(css).toContain('text-shadow:'); // readable label on the fill
    expect(css).not.toContain('#123456'); // Unused: not present
    expect(css).not.toContain('padding-left'); // fill-only → no strip → no extra inset
    expect(css).not.toContain('::before'); // fill draws no strip (bug 2)
  });

  it('fill=none/strip=status: emits ::before accent rules, not background fills', () => {
    const css = styleFor({
      fillSource: 'none',
      stripSource: 'status',
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

  it('keys fill and strip on the priority palette independently', () => {
    const fill = styleFor({ fillSource: 'priority', stripSource: 'none', palettes, instances: [inst(null, 'high')] });
    expect(fill).toContain(`.wx-bar.${prioritySlug('high')} { background-color: #ff0000 !important;`);
    const strip = styleFor({ fillSource: 'none', stripSource: 'priority', palettes, instances: [inst(null, 'high')] });
    expect(strip).toContain(`.wx-bar.${prioritySlug('high')}::before`);
  });

  it('fill=theme: uses the theme accent (child) + a tonal-shifted accent (parent), not fixed hues', () => {
    const css = styleFor({ fillSource: 'theme', stripSource: 'none', palettes: { status: [], priority: [] }, instances: [] });
    expect(css).toContain('background-color: var(--interactive-accent) !important;'); // child = raw theme accent
    expect(css).toContain(
      `.wx-bar.${PARENT_ROLE_CLASS} { background-color: color-mix(in srgb, var(--interactive-accent), var(--text-normal) 30%) !important;`,
    ); // parent = more-contrasting tone of the SAME accent
    expect(css).not.toContain('--color-'); // never a fixed named-palette hue
    expect(css).not.toContain('::before'); // fill-only theme draws no strip
  });

  it('strip=theme: emits a neutral body + theme-accent ::before rules', () => {
    const css = styleFor({ fillSource: 'none', stripSource: 'theme', palettes, instances: [] });
    // Body is mixed a bit off the background so it stays visible in low-contrast themes.
    expect(css).toContain('background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important;');
    expect(css).toContain(
      `.wx-bar.${PARENT_ROLE_CLASS}::before { background-color: color-mix(in srgb, var(--interactive-accent), var(--text-normal) 30%); }`,
    );
    // Progress shifts the neutral body, not the accent strip.
    expect(css).toContain('.wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }');
    expect(css).not.toContain('.wx-progress-percent { background-color: color-mix(in srgb, var(--interactive-accent)');
  });

  it('strip=default: parent body is a higher-contrast neutral than the child body (hierarchy cue)', () => {
    const css = styleFor({ fillSource: 'none', stripSource: 'default', palettes, instances: [] });
    // Child/base neutral body (16% toward text)...
    expect(css).toContain('.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important;');
    // ...and a more prominent parent body override (30%), contrast-only (no opacity).
    expect(css).toContain(
      `.og-bases-gantt .wx-bar.${PARENT_ROLE_CLASS} { background-color: color-mix(in srgb, var(--text-normal) 30%, var(--background-primary)) !important; }`,
    );
    expect(css).not.toContain('opacity');
  });

  it('fill=default: emits fixed green-parent / blue-child role rules (no palette)', () => {
    const css = styleFor({ fillSource: 'default', stripSource: 'none', palettes, instances: [inst('11🟥Active = Now')] });
    expect(css).toContain('background-color: #1f6feb !important;'); // child (blue)
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: #2ea043 !important;`); // parent (green)
    expect(css).not.toContain('#f8312f'); // does not consult the status palette
  });

  it('fill channel: progress is a contrasting shift of the bar fill accent (not SVAR blue)', () => {
    const fill = styleFor({ fillSource: 'status', stripSource: 'none', palettes, instances: [inst('11🟥Active = Now')] });
    expect(fill).toContain(
      `.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')} .wx-progress-percent { background-color: color-mix(in srgb, #f8312f, var(--text-normal) 30%) !important; }`,
    );
  });

  it('strip channel: progress shifts the NEUTRAL bar body, not the strip accent', () => {
    const strip = styleFor({ fillSource: 'none', stripSource: 'status', palettes, instances: [inst('11🟥Active = Now')] });
    // Progress is a tonal shift of the shared neutral body...
    expect(strip).toContain(
      '.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }',
    );
    // ...never the strip accent color extended rightward.
    expect(strip).not.toContain('color-mix(in srgb, #f8312f');
  });

  it('fill=default: progress follows the role colors (contrasted child + parent)', () => {
    const css = styleFor({ fillSource: 'default', stripSource: 'none', palettes, instances: [] });
    expect(css).toContain('.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, #1f6feb, var(--text-normal) 30%) !important; }');
    expect(css).toContain(
      `.og-bases-gantt .wx-bar.${PARENT_ROLE_CLASS} .wx-progress-percent { background-color: color-mix(in srgb, #2ea043, var(--text-normal) 30%) !important; }`,
    );
  });

  it('degrades a channel to the Default role style when its source palette is empty (standalone)', () => {
    // No TaskNotes palette → By Status/Priority behaves like Default (R15/F3), not blank.
    const css = styleFor({ fillSource: 'status', stripSource: 'none', palettes: { status: [], priority: [] }, instances: [inst('x')] });
    expect(css).toContain('background-color: #1f6feb !important;'); // child (default blue)
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: #2ea043 !important;`); // parent (default green)
  });

  it('dedupes a value present on multiple instances', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'none',
      palettes,
      instances: [inst('11🟥Active = Now'), inst('11🟥Active = Now')],
    });
    expect(css.match(/background-color: #f8312f !important;/g)).toHaveLength(1);
  });

  it('skips an unsafe palette color on the fill channel (CSS-injection guard)', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'none',
      palettes: { status: [{ value: 'Evil', color: 'red; } body { display: none', isCompleted: false }], priority: [] },
      instances: [inst('Evil')],
    });
    expect(css).toBe('');
  });

  it('skips an unsafe palette color on the strip channel (CSS-injection guard)', () => {
    const css = styleFor({
      fillSource: 'none',
      stripSource: 'status',
      palettes: { status: [{ value: 'Evil', color: 'red; } body { display: none', isCompleted: false }], priority: [] },
      instances: [inst('Evil')],
    });
    expect(css).toBe('');
  });

  it('drops a CSS-keyword color (transparent) that would render an invisible bar', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'none',
      palettes: { status: [{ value: 'x', color: 'transparent', isCompleted: false }], priority: [] },
      instances: [inst('x')],
    });
    expect(css).toBe('');
  });

  // ---- P2e regression characterizations (the two coupling bugs) ----

  it('BUG 1: fill=none/strip=status paints ONLY the strip — the body stays neutral, never a per-status fill', () => {
    const css = styleFor({
      fillSource: 'none',
      stripSource: 'status',
      palettes,
      instances: [inst('11🟥Active = Now')],
    });
    const statusSel = `.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')}`;
    // The status accent is a ::before strip...
    expect(css).toContain(`${statusSel}::before`);
    // ...and the shared neutral body is present for all bars.
    expect(css).toContain('.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important;');
    // ...but NO per-status rule paints the bar body with the status colour.
    expect(css).not.toContain(`${statusSel} { background-color: #f8312f`);
    expect(css).not.toContain('--og-ghost-fill:');
  });

  it('BUG 2: fill=calendar/strip=none draws ZERO strips — no ::before anywhere', () => {
    const withCal: Palettes = { ...palettes, calendar: [{ value: 'Cal/A.md', color: '#2a9d8f' }] };
    const css = styleFor({
      fillSource: 'calendar',
      stripSource: 'none',
      palettes: withCal,
      instances: [{ status: null, priority: null, calendarId: 'Cal/A.md' }],
    });
    // Per-calendar fill body present...
    expect(css).toContain(`.wx-bar.${calendarSlug('Cal/A.md')} { background-color: #2a9d8f !important;`);
    // ...and no strip drawn at all.
    expect(css).not.toContain('::before');
    expect(css).not.toContain('width: 6px;');
    expect(css).not.toContain('padding-left');
  });

  // ---- Two-channel and both-none composition ----

  it('fill=status + strip=priority: status fill-body rules AND priority ::before strips coexist on distinct classes', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'priority',
      palettes,
      instances: [inst('11🟥Active = Now', 'high')],
    });
    expect(css).toContain(`.wx-bar.${statusSlug('11🟥Active = Now')} { background-color: #f8312f !important;`);
    expect(css).toContain(`.wx-bar.${prioritySlug('high')}::before`);
    // Fill supplies the body, so no neutral strip-body scaffolding / content inset.
    expect(css).not.toContain('padding-left');
    expect(css).not.toContain('color: var(--text-normal) !important');
  });

  it('redundant fill=status + strip=status: the one status class carries BOTH a fill body and a ::before strip', () => {
    const css = styleFor({
      fillSource: 'status',
      stripSource: 'status',
      palettes,
      instances: [inst('11🟥Active = Now')],
    });
    const statusSel = `.og-bases-gantt .wx-bar.${statusSlug('11🟥Active = Now')}`;
    expect(css).toContain(`${statusSel} { background-color: #f8312f !important;`);
    expect(css).toContain(`${statusSel}::before`);
  });

  it('fill=none + strip=none: falls back to the default role fill so a bar is never invisible', () => {
    const css = styleFor({ fillSource: 'none', stripSource: 'none', palettes, instances: [inst('11🟥Active = Now')] });
    expect(css).toContain('background-color: #1f6feb !important;'); // default child (blue)
    expect(css).toContain(`.wx-bar.${PARENT_ROLE_CLASS} { background-color: #2ea043 !important;`); // default parent (green)
    expect(css).not.toContain('::before');
  });
});

describe('buildTreatmentStyle scope parameterization (multi-instance leak guard)', () => {
  it('anchors every generated rule under the given per-instance scope, never a shared one', () => {
    const css = buildTreatmentStyle({
      scope: '.og-gantt-test',
      fillSource: 'status',
      stripSource: 'none',
      palettes,
      instances: [inst('11🟥Active = Now')],
    });
    // Rules anchor under the unique per-instance scope...
    expect(css).toContain(`.og-gantt-test .wx-bar.${statusSlug('11🟥Active = Now')}`);
    // ...and never under the shared `.og-bases-gantt` root that every instance
    // carries (that shared anchor is exactly what leaked across instances).
    expect(css).not.toContain('.og-bases-gantt .wx-bar');
  });
});

describe('buildTreatmentStyle fidelity (legacy configs render byte-identically)', () => {
  // Golden masters captured from the pre-decoupling builder for the migrated-
  // equivalent inputs. A byte-for-byte match proves the read-time migration is
  // fidelity-first (R8/KTD6): a legacy `mode=fill|strip, source=X` view renders
  // exactly as before under `fill=X,strip=none` / `fill=none,strip=X`.
  const fidelityPalettes: Palettes = {
    status: statusColors,
    priority: priorityColors,
    calendar: [
      { value: 'Calendars/NZ.md', color: '#2a9d8f' },
      { value: 'Calendars/APAC.md', color: '#e76f51' },
    ],
  };
  const s = (st: string | null, pr: string | null = null, cal: string | null = null) => ({ status: st, priority: pr, calendarId: cal });

  const GOLDEN_FILL_STATUS =
    '.og-bases-gantt .wx-bar.og-status-11-active-now-85dpg9 { background-color: #f8312f !important; --og-ghost-fill: #f8312f; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-status-11-active-now-85dpg9 .wx-progress-percent { background-color: color-mix(in srgb, #f8312f, var(--text-normal) 30%) !important; }\n.og-bases-gantt .wx-bar.og-status-41-done-recent-3ulrx3 { background-color: #00d26a !important; --og-ghost-fill: #00d26a; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-status-41-done-recent-3ulrx3 .wx-progress-percent { background-color: color-mix(in srgb, #00d26a, var(--text-normal) 30%) !important; }';

  const GOLDEN_STRIP_STATUS =
    '.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important; color: var(--text-normal) !important; border: 1px solid color-mix(in srgb, var(--text-normal) 38%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar .wx-content { padding-left: 10px !important; }\n.og-bases-gantt .wx-bar.og-status-11-active-now-85dpg9::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #f8312f; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }\n.og-bases-gantt .wx-bar.og-status-41-done-recent-3ulrx3::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #00d26a; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }';

  const GOLDEN_FILL_DEFAULT =
    '.og-bases-gantt .wx-bar { background-color: #1f6feb !important; --og-ghost-fill: #1f6feb; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-parent { background-color: #2ea043 !important; }\n.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, #1f6feb, var(--text-normal) 30%) !important; }\n.og-bases-gantt .wx-bar.og-parent .wx-progress-percent { background-color: color-mix(in srgb, #2ea043, var(--text-normal) 30%) !important; }';

  const GOLDEN_STRIP_DEFAULT =
    '.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important; color: var(--text-normal) !important; border: 1px solid color-mix(in srgb, var(--text-normal) 38%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar.og-parent { background-color: color-mix(in srgb, var(--text-normal) 30%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #1f6feb; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }\n.og-bases-gantt .wx-bar.og-parent::before { background-color: #2ea043; }\n.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar .wx-content { padding-left: 10px !important; }';

  const GOLDEN_FILL_CALENDAR =
    '.og-bases-gantt .wx-bar { background-color: #1f6feb !important; --og-ghost-fill: #1f6feb; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-parent { background-color: #2ea043 !important; }\n.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, #1f6feb, var(--text-normal) 30%) !important; }\n.og-bases-gantt .wx-bar.og-parent .wx-progress-percent { background-color: color-mix(in srgb, #2ea043, var(--text-normal) 30%) !important; }\n.og-bases-gantt .wx-bar.og-calendar-calendars-nz-md-1ni9xhk { background-color: #2a9d8f !important; --og-ghost-fill: #2a9d8f; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-calendar-calendars-nz-md-1ni9xhk .wx-progress-percent { background-color: color-mix(in srgb, #2a9d8f, var(--text-normal) 30%) !important; }\n.og-bases-gantt .wx-bar.og-calendar-calendars-apac-md-nzt72t { background-color: #e76f51 !important; --og-ghost-fill: #e76f51; color: var(--text-on-accent, #fff) !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }\n.og-bases-gantt .wx-bar.og-calendar-calendars-apac-md-nzt72t .wx-progress-percent { background-color: color-mix(in srgb, #e76f51, var(--text-normal) 30%) !important; }';

  const GOLDEN_STRIP_CALENDAR =
    '.og-bases-gantt .wx-bar { background-color: color-mix(in srgb, var(--text-normal) 16%, var(--background-primary)) !important; color: var(--text-normal) !important; border: 1px solid color-mix(in srgb, var(--text-normal) 38%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar.og-parent { background-color: color-mix(in srgb, var(--text-normal) 30%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #1f6feb; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }\n.og-bases-gantt .wx-bar.og-parent::before { background-color: #2ea043; }\n.og-bases-gantt .wx-bar .wx-progress-percent { background-color: color-mix(in srgb, var(--text-normal) 45%, var(--background-primary)) !important; }\n.og-bases-gantt .wx-bar .wx-content { padding-left: 10px !important; }\n.og-bases-gantt .wx-bar.og-calendar-calendars-nz-md-1ni9xhk::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #2a9d8f; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }\n.og-bases-gantt .wx-bar.og-calendar-calendars-apac-md-nzt72t::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; width: 6px; background-color: #e76f51; border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }';

  it('fill=status,strip=none == legacy mode=fill,source=status', () => {
    expect(
      styleFor({ fillSource: 'status', stripSource: 'none', palettes: fidelityPalettes, instances: [s('11🟥Active = Now'), s('41🟩Done = Recent')] }),
    ).toBe(GOLDEN_FILL_STATUS);
  });

  it('fill=none,strip=status == legacy mode=strip,source=status', () => {
    expect(
      styleFor({ fillSource: 'none', stripSource: 'status', palettes: fidelityPalettes, instances: [s('11🟥Active = Now'), s('41🟩Done = Recent')] }),
    ).toBe(GOLDEN_STRIP_STATUS);
  });

  it('fill=default,strip=none == legacy mode=fill,source=default', () => {
    expect(
      styleFor({ fillSource: 'default', stripSource: 'none', palettes: fidelityPalettes, instances: [s('11🟥Active = Now')] }),
    ).toBe(GOLDEN_FILL_DEFAULT);
  });

  it('fill=none,strip=default == legacy mode=strip,source=default', () => {
    expect(
      styleFor({ fillSource: 'none', stripSource: 'default', palettes: fidelityPalettes, instances: [s('11🟥Active = Now')] }),
    ).toBe(GOLDEN_STRIP_DEFAULT);
  });

  it('fill=calendar,strip=none == legacy mode=fill,source=calendar', () => {
    expect(
      styleFor({ fillSource: 'calendar', stripSource: 'none', palettes: fidelityPalettes, instances: [s(null, null, 'Calendars/NZ.md'), s(null, null, 'Calendars/APAC.md')] }),
    ).toBe(GOLDEN_FILL_CALENDAR);
  });

  it('fill=none,strip=calendar == legacy mode=strip,source=calendar', () => {
    expect(
      styleFor({ fillSource: 'none', stripSource: 'calendar', palettes: fidelityPalettes, instances: [s(null, null, 'Calendars/NZ.md'), s(null, null, 'Calendars/APAC.md')] }),
    ).toBe(GOLDEN_STRIP_CALENDAR);
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
    expect(resolveIconSpec('priority', inst(null, 'low'), palettes)).toEqual({ kind: 'priority', color: '#00aaff' });
  });

  it('marks a completed no-icon status as completed (filled disc, mirroring TaskNotes)', () => {
    expect(resolveIconSpec('status', inst('41🟩Done = Recent'), palettes)).toEqual({
      kind: 'status',
      color: '#00d26a',
      completed: true,
    });
  });

  it('does not mark a non-completed no-icon status as completed (hollow ring)', () => {
    // 'Unused' has isCompleted:false; the completed key is absent, not false.
    expect(resolveIconSpec('status', inst('Unused'), palettes)).toEqual({ kind: 'status', color: '#123456' });
  });

  it('never marks a priority chip as completed (priorities have no completion concept)', () => {
    expect(resolveIconSpec('priority', inst(null, 'low'), palettes)).not.toHaveProperty('completed');
  });

  it('attaches completed to a completed status even when it has an icon (glyph still renders)', () => {
    const p: Palettes = {
      status: [{ value: 'done', color: '#00d26a', isCompleted: true, icon: 'check' }],
      priority: [],
    };
    expect(resolveIconSpec('status', inst('done'), p)).toEqual({
      kind: 'status',
      iconName: 'check',
      color: '#00d26a',
      completed: true,
    });
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

describe('calendar color source (U12)', () => {
  const calendarPalette = [
    { value: 'Calendars/NZ.md', color: '#2a9d8f' },
    { value: 'Calendars/APAC.md', color: '#e76f51' },
    { value: 'Calendars/Unsafe.md', color: 'url(evil)' },
  ];
  const withCalendars: Palettes = { ...palettes, calendar: calendarPalette };
  const calInst = (calendarId: string | null) => ({ status: null, priority: null, calendarId });

  it('emits a fill rule per present calendar colour', () => {
    const css = styleFor({
      fillSource: 'calendar',
      stripSource: 'none',
      palettes: withCalendars,
      instances: [calInst('Calendars/NZ.md'), calInst('Calendars/APAC.md')],
    });
    expect(css).toContain(`.wx-bar.${calendarSlug('Calendars/NZ.md')} { background-color: #2a9d8f !important;`);
    expect(css).toContain('background-color: #e76f51 !important;');
  });

  it('emits a strip rule per present calendar colour', () => {
    const css = styleFor({
      fillSource: 'none',
      stripSource: 'calendar',
      palettes: withCalendars,
      instances: [calInst('Calendars/NZ.md')],
    });
    expect(css).toContain(`.wx-bar.${calendarSlug('Calendars/NZ.md')}::before`);
    expect(css).toContain('background-color: #2a9d8f;');
  });

  it('keeps the default role rules so an unassociated task is still treated', () => {
    const css = styleFor({
      fillSource: 'calendar',
      stripSource: 'none',
      palettes: withCalendars,
      instances: [calInst('Calendars/NZ.md'), calInst(null)],
    });
    expect(css).toContain(PARENT_ROLE_CLASS);
  });

  it('resolves a set-linked task to the set id, so the set colour wins', () => {
    // The resolver is identity-driven: a set-linked task carries the SET's id.
    expect(resolveTreatmentClass({ fillSource: 'calendar', stripSource: 'none', instance: calInst('Calendars/APAC.md'), isParent: false, palettes: withCalendars })).toEqual([
      calendarSlug('Calendars/APAC.md'),
    ]);
  });

  it('falls back to the default treatment for an unassociated task', () => {
    expect(resolveTreatmentClass({ fillSource: 'calendar', stripSource: 'none', instance: calInst(null), isParent: false, palettes: withCalendars })).toEqual([]);
    expect(resolveTreatmentClass({ fillSource: 'calendar', stripSource: 'none', instance: calInst(null), isParent: true, palettes: withCalendars })).toEqual([PARENT_ROLE_CLASS]);
  });

  it('ignores a calendar whose authored colour is unsafe', () => {
    expect(resolveTreatmentClass({ fillSource: 'calendar', stripSource: 'none', instance: calInst('Calendars/Unsafe.md'), isParent: false, palettes: withCalendars })).toEqual([]);
    const css = styleFor({
      fillSource: 'calendar',
      stripSource: 'none',
      palettes: withCalendars,
      instances: [calInst('Calendars/Unsafe.md')],
    });
    expect(css).not.toContain('url(evil)');
  });

  it('degrades to the default source when the vault has no calendars', () => {
    const css = styleFor({
      fillSource: 'calendar',
      stripSource: 'none',
      palettes,
      instances: [calInst('Calendars/NZ.md')],
    });
    expect(css).toContain(PARENT_ROLE_CLASS);
    expect(css).not.toContain('og-calendar-');
  });

  it('registers calendar classes so SVAR can match the composed bar type', () => {
    const registry = treatmentClassRegistry(withCalendars);
    expect(registry).toContain(calendarSlug('Calendars/NZ.md'));
    expect(registry).toContain(calendarSlug('Calendars/APAC.md'));
    expect(registry).not.toContain(calendarSlug('Calendars/Unsafe.md'));
  });

  it('slugs a vault path into a CSS-safe class distinct from the shading cell class', () => {
    expect(calendarSlug('Calendars/NZ.md')).toMatch(/^og-calendar-[a-z0-9_-]+$/i);
    // A calendar literally named "cell" must not collide with `og-cal-cell`.
    expect(calendarSlug('cell')).not.toBe('og-cal-cell');
  });
});
