import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  checkSettingsCoverage,
  expandHeading,
  NON_CONTROL_HEADINGS,
  parseSettingsHeadings,
  settingsInventory,
  settingsPageForGroup,
  type SettingsPage,
} from '../../scripts/check-settings-coverage.mjs';
import { ganttViewOptions } from '../../src/bases/viewOptions';
import {
  calendarItemOptionsGroup,
  EXTERNAL_PROVIDER_ORDER,
  externalCalendarDegradedEntry,
  externalCalendarOptionEntries,
  externalCalendarToggleKey,
} from '../../src/bases/calendarItemOptions';
import { TOOLBAR_PERSISTED_CONTROLS } from '../../src/bases/themeResolver';

/**
 * The guard is proven by the plan's mutation set: each case edits the REAL
 * settings pages in memory and must produce a finding. A case that stays green
 * means the guard cannot see that class of drift.
 */
const SETTINGS_DIR = resolve('website/docs/settings');

const BUILDERS = {
  ganttViewOptions,
  calendarItemOptionsGroup,
  externalCalendarOptionEntries,
  externalCalendarDegradedEntry,
  externalCalendarToggleKey,
  EXTERNAL_PROVIDER_ORDER,
  TOOLBAR_PERSISTED_CONTROLS,
};

function readRealPages(): SettingsPage[] {
  return readdirSync(SETTINGS_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, markdown: readFileSync(join(SETTINGS_DIR, file), 'utf8') }));
}

function replaceOnPage(pages: SettingsPage[], file: string, from: string, to: string): SettingsPage[] {
  return pages.map((page) => {
    if (page.file !== file) return page;
    if (!page.markdown.includes(from)) throw new Error(`mutation anchor missing in ${file}: ${from}`);
    return { file, markdown: page.markdown.replace(from, to) };
  });
}

function appendToPage(pages: SettingsPage[], file: string, text: string): SettingsPage[] {
  return pages.map((page) => (page.file === file ? { file, markdown: `${page.markdown}\n${text}\n` } : page));
}

function findingsFor(pages: SettingsPage[]): string[] {
  return checkSettingsCoverage({ controls: settingsInventory(BUILDERS), pages }).findings;
}

describe('check-settings-coverage on the real tree', () => {
  it('reports no findings for the shipped controls against the committed pages', () => {
    expect(findingsFor(readRealPages())).toEqual([]);
  });

  it('inventories the companion-gated, per-provider and degraded controls', () => {
    const names = settingsInventory(BUILDERS).map((control) => `${control.group} › ${control.name}`);

    expect(names).toEqual(
      expect.arrayContaining([
        'Relationships › Expanded relationships',
        'Progress › Progress mode',
        'Fields › Time Estimate Update',
        'Calendar items › External calendars',
        'Appearance › Theme mode',
      ]),
    );
  });

  it('exempts every per-feed toggle, whose label is the user feed name', () => {
    const prefixes = EXTERNAL_PROVIDER_ORDER.map((kind) => externalCalendarToggleKey(kind, ''));
    const keys = settingsInventory(BUILDERS).map((control) => control.key ?? '');

    expect(keys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))).toEqual([]);
  });
});

describe('check-settings-coverage mutation set', () => {
  it('(1) a removed static heading is reported undocumented', () => {
    const pages = replaceOnPage(readRealPages(), 'calendar-items.md', '## Show recurring tasks', '## Recurring tasks');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Calendar items › Show recurring tasks')]),
    );
  });

  it('(2) a heading carrying an attribute list still has to match exactly', () => {
    const pages = replaceOnPage(
      readRealPages(),
      'fields.md',
      '## Time Estimate Property { #time-estimate-property }',
      '## Time Estimate { #time-estimate-property }',
    );

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Fields › Time Estimate Property')]),
    );
  });

  it('(3) a collapsed heading that drops one of its controls reports that control', () => {
    const pages = replaceOnPage(
      readRealPages(),
      'calendar-items.md',
      '### Event start / end / title property',
      '### Event start / end property',
    );

    expect(findingsFor(pages)).toEqual([
      expect.stringContaining('undocumented: Calendar items › Event title property'),
    ]);
  });

  it('(4) a removed companion-gated heading is reported undocumented', () => {
    const pages = replaceOnPage(
      readRealPages(),
      'relationships.md',
      '## Expanded relationships',
      '## Expanded relations',
    );

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Relationships › Expanded relationships')]),
    );
  });

  it('(6) a heading moved to another group page is reported misfiled', () => {
    const moved = replaceOnPage(readRealPages(), 'timeline.md', '## Estimate meaning\n', '## Estimate meaning moved\n');
    const pages = appendToPage(moved, 'appearance.md', '## Estimate meaning');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('misfiled: Timeline › Estimate meaning is on appearance.md, expected timeline.md'),
      ]),
    );
  });

  it('(7) a heading duplicated onto a second page is reported duplicated', () => {
    const pages = appendToPage(readRealPages(), 'appearance.md', '## Estimate meaning');

    expect(findingsFor(pages)).toEqual([
      expect.stringContaining('duplicated: Timeline › Estimate meaning has 2 headings'),
    ]);
  });

  it('a removed toolbar-persisted heading is reported undocumented', () => {
    const pages = replaceOnPage(readRealPages(), 'appearance.md', '## Theme mode', '## Theme');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Appearance › Theme mode')]),
    );
  });
});

describe('checkSettingsCoverage', () => {
  const control = { group: 'Timeline', name: 'Default Scale' };

  it('reports a heading that is neither a control nor allow-listed', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n\n## Something new\n' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList: [] }).findings).toEqual([
      'unknown heading: timeline.md: Something new',
    ]);
  });

  it('accepts an allow-listed non-control heading on its own page', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n\n## Related\n' }];
    const allowList = [{ page: 'timeline.md', heading: 'Related' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList }).findings).toEqual([]);
  });

  it('does not accept an allow-listed heading on a different page', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n\n## Related\n' }];
    const allowList = [{ page: 'appearance.md', heading: 'Related' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList }).findings).toEqual([
      'unknown heading: timeline.md: Related',
      'stale allow-list entry: appearance.md: Related',
    ]);
  });

  it('reports an allow-list entry whose heading no longer exists', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n' }];
    const allowList = [{ page: 'timeline.md', heading: 'Related' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList }).findings).toEqual([
      'stale allow-list entry: timeline.md: Related',
    ]);
  });

  it('reports a group with no settings page instead of skipping it', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n' }];
    const orphan = { group: 'Brand new group', name: 'Knob' };

    expect(checkSettingsCoverage({ controls: [control, orphan], pages, allowList: [] }).findings).toEqual([
      'no settings page for group "Brand new group" (expected brand-new-group.md)',
      'undocumented: Brand new group › Knob',
    ]);
  });

  it('matches case-sensitively and never by prefix', () => {
    const pages = [{ file: 'timeline.md', markdown: '## default scale\n\n## Default Scale and more\n' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList: [] }).findings).toEqual([
      'undocumented: Timeline › Default Scale',
      'unknown heading: timeline.md: default scale',
      'unknown heading: timeline.md: Default Scale and more',
    ]);
  });

  it('refuses an empty control inventory rather than passing vacuously', () => {
    const pages = [{ file: 'timeline.md', markdown: '## Default Scale\n' }];

    expect(() => checkSettingsCoverage({ controls: [], pages, allowList: [] })).toThrow(/no shipped controls/);
  });

  it('refuses an empty page set rather than passing vacuously', () => {
    expect(() => checkSettingsCoverage({ controls: [control], pages: [], allowList: [] })).toThrow(/no settings pages/);
  });

  it('allow-lists only real headings on the committed pages', () => {
    const pages = readRealPages();

    for (const entry of NON_CONTROL_HEADINGS) {
      const headings = parseSettingsHeadings(pages).filter((heading) => heading.file === entry.page);
      expect(headings.map((heading) => heading.text)).toContain(entry.heading);
    }
  });
});

describe('parseSettingsHeadings', () => {
  it('reads level-2 and level-3 headings and strips a trailing attribute list', () => {
    const pages = [{ file: 'fields.md', markdown: '# Fields\n## A { #a }\n### B\n#### C\n' }];

    expect(parseSettingsHeadings(pages).map((heading) => heading.text)).toEqual(['A', 'B']);
  });

  it('ignores heading-shaped lines inside fenced code blocks', () => {
    const pages = [{ file: 'fields.md', markdown: '## A\n```yaml\n## not a heading\n```\n~~~\n## nor this\n~~~\n## B\n' }];

    expect(parseSettingsHeadings(pages).map((heading) => heading.text)).toEqual(['A', 'B']);
  });
});

describe('expandHeading', () => {
  it('expands a collapsed heading into one name per variant', () => {
    expect(expandHeading('Event start / end / title property')).toEqual([
      'Event start property',
      'Event end property',
      'Event title property',
    ]);
  });

  it('leaves an ordinary heading as a single name', () => {
    expect(expandHeading('Min height (px)')).toEqual(['Min height (px)']);
  });

  it('does not expand when a middle variant has several words', () => {
    expect(expandHeading('Event start / end date / title property')).toEqual([
      'Event start / end date / title property',
    ]);
  });
});

describe('settingsPageForGroup', () => {
  it('derives the kebab-case page from the group name', () => {
    expect(settingsPageForGroup('Calendar items')).toBe('calendar-items.md');
    expect(settingsPageForGroup('Fields')).toBe('fields.md');
  });
});
