import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkSettingsCoverage,
  expandHeading,
  NON_CONTROL_HEADINGS,
  parseSettingsHeadings,
  readSettingsPages,
  settingsInventory,
  settingsPageForGroup,
  unmodelledMarkdownFindings,
  type SettingsPage,
} from '../../scripts/check-settings-coverage.mjs';
import { EXTERNAL_PROVIDER_ORDER, externalCalendarToggleKey } from '../../src/bases/calendarItemOptions';
import { SETTINGS_BUILDERS as BUILDERS } from '../helpers/settingsCoverageBuilders';

/**
 * The guard is proven by the plan's mutation set: each case edits the REAL
 * settings pages in memory and must produce a finding. A case that stays green
 * means the guard cannot see that class of drift.
 */

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
    expect(findingsFor(readSettingsPages())).toEqual([]);
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
    const keys = settingsInventory(BUILDERS).flatMap((control) => control.keys);

    expect(keys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))).toEqual([]);
  });
});

/** The real builders with the Timeline and Calendar items groups replaced by `timeline` / `calendarItems`. */
function buildersWith(timeline: object[], calendarItems: object[] = []): typeof BUILDERS {
  return {
    ...BUILDERS,
    ganttViewOptions: () => [{ type: 'group', displayName: 'Timeline', items: timeline }],
    calendarItemOptionsGroup: () => ({ type: 'group', displayName: 'Calendar items', items: [...calendarItems] }),
    TOOLBAR_PERSISTED_CONTROLS: [],
  } as unknown as typeof BUILDERS;
}

describe('settingsInventory', () => {
  it('keeps two controls that share one label visible as a shared-label finding', () => {
    const builders = buildersWith([
      { type: 'toggle', displayName: 'Knob', key: 'tngantt_knobA', default: false },
      { type: 'toggle', displayName: 'Knob', key: 'tngantt_knobB', default: false },
    ]);
    const pages = [
      { file: 'timeline.md', markdown: '## Knob\n' },
      { file: 'calendar-items.md', markdown: '### ICS calendars\n### Google calendars\n### Microsoft calendars\n## External calendars\n' },
    ];

    expect(checkSettingsCoverage({ controls: settingsInventory(builders), pages, allowList: [] }).findings).toEqual([
      'shared label: Timeline › Knob names 2 controls (tngantt_knobA, tngantt_knobB)',
    ]);
  });

  it('reports an option that shares its label with a toolbar-persisted control', () => {
    const builders = {
      ...buildersWith([{ type: 'toggle', displayName: 'Theme mode', key: 'tngantt_themeModeToggle', default: false }]),
      TOOLBAR_PERSISTED_CONTROLS: [{ uiLabel: 'Theme', docHeading: 'Theme mode', group: 'Timeline' }],
    };

    expect(settingsInventory(builders)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'Timeline',
          name: 'Theme mode',
          keys: ['tngantt_themeModeToggle', 'toolbar:Theme'],
        }),
      ]),
    );
  });

  it('reports one control rendered twice in a panel even when both copies share a key', () => {
    const knob = { type: 'toggle', displayName: 'Knob', key: 'tngantt_knob', default: false };
    const builders = buildersWith([knob, { ...knob }]);
    const pages = [
      { file: 'timeline.md', markdown: '## Knob\n' },
      { file: 'calendar-items.md', markdown: '### ICS calendars\n### Google calendars\n### Microsoft calendars\n## External calendars\n' },
    ];

    expect(checkSettingsCoverage({ controls: settingsInventory(builders), pages, allowList: [] }).findings).toEqual([
      'shared label: Timeline › Knob names 2 controls (tngantt_knob)',
    ]);
  });

  it('inventories a static entry whose key merely starts like a per-feed toggle', () => {
    const staticKey = externalCalendarToggleKey(EXTERNAL_PROVIDER_ORDER[0], 'static-entry');
    const builders = buildersWith([], [{ type: 'toggle', displayName: 'Static entry', key: staticKey, default: false }]);

    expect(settingsInventory(builders)).toEqual(
      expect.arrayContaining([expect.objectContaining({ group: 'Calendar items', name: 'Static entry', keys: [staticKey] })]),
    );
  });
});

describe('check-settings-coverage mutation set', () => {
  it('(1) a removed static heading is reported undocumented', () => {
    const pages = replaceOnPage(readSettingsPages(), 'calendar-items.md', '## Show recurring tasks', '## Recurring tasks');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Calendar items › Show recurring tasks')]),
    );
  });

  it('(2) a heading carrying an attribute list still has to match exactly', () => {
    const pages = replaceOnPage(
      readSettingsPages(),
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
      readSettingsPages(),
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
      readSettingsPages(),
      'relationships.md',
      '## Expanded relationships',
      '## Expanded relations',
    );

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Relationships › Expanded relationships')]),
    );
  });

  it('(6) a heading moved to another group page is reported misfiled', () => {
    const moved = replaceOnPage(readSettingsPages(), 'timeline.md', '## Estimate meaning\n', '## Estimate meaning moved\n');
    const pages = appendToPage(moved, 'appearance.md', '## Estimate meaning');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('misfiled: Timeline › Estimate meaning is on appearance.md, expected timeline.md'),
      ]),
    );
  });

  it('(7) a heading duplicated onto a second page is reported duplicated', () => {
    const pages = appendToPage(readSettingsPages(), 'appearance.md', '## Estimate meaning');

    expect(findingsFor(pages)).toEqual([
      expect.stringContaining('duplicated: Timeline › Estimate meaning has 2 headings'),
    ]);
  });

  it('a removed toolbar-persisted heading is reported undocumented', () => {
    const pages = replaceOnPage(readSettingsPages(), 'appearance.md', '## Theme mode', '## Theme');

    expect(findingsFor(pages)).toEqual(
      expect.arrayContaining([expect.stringContaining('undocumented: Appearance › Theme mode')]),
    );
  });
});

describe('checkSettingsCoverage', () => {
  const control = { group: 'Timeline', name: 'Default Scale', keys: ['tngantt_defaultScale'] };

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
    const orphan = { group: 'Brand new group', name: 'Knob', keys: ['tngantt_knob'] };

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

  it('accepts same-named controls in two groups, each documented on its own page', () => {
    const controls = [
      { group: 'Timeline', name: 'Mode', keys: ['tngantt_timelineMode'] },
      { group: 'Appearance', name: 'Mode', keys: ['tngantt_appearanceMode'] },
    ];
    const pages = [
      { file: 'timeline.md', markdown: '## Mode\n' },
      { file: 'appearance.md', markdown: '## Mode\n' },
    ];

    expect(checkSettingsCoverage({ controls, pages, allowList: [] }).findings).toEqual([]);
  });

  it('still reports a same-named control whose own page lacks its heading', () => {
    const controls = [
      { group: 'Timeline', name: 'Mode', keys: ['tngantt_timelineMode'] },
      { group: 'Appearance', name: 'Mode', keys: ['tngantt_appearanceMode'] },
    ];
    const pages = [
      { file: 'timeline.md', markdown: '## Mode\n' },
      { file: 'appearance.md', markdown: '## Other\n' },
    ];

    expect(checkSettingsCoverage({ controls, pages, allowList: [] }).findings).toEqual([
      'undocumented: Appearance › Mode',
      'unknown heading: appearance.md: Other',
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
    const pages = readSettingsPages();

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

  it('reads only the canonical form: column 0, a space, no closing hashes', () => {
    const pages = [{ file: 'fields.md', markdown: '## A\n   ## indented\n##unspaced\n## closed ##\n' }];

    expect(parseSettingsHeadings(pages).map((heading) => heading.text)).toEqual(['A']);
  });
});

describe('unmodelledMarkdownFindings', () => {
  it.each([
    ['a backtick fence', '```yaml', 'unsupported markdown: fields.md:2: ```yaml'],
    ['a tilde fence', '~~~', 'unsupported markdown: fields.md:2: ~~~'],
    ['a raw HTML block', '<pre>', 'unsupported markdown: fields.md:2: <pre>'],
    ['an HTML comment opening mid-line', 'Some prose <!-- hidden', 'unsupported markdown: fields.md:2: Some prose <!-- hidden'],
    ['an indented hash line, a paragraph or a nested heading', '    ## Inside', 'unsupported markdown: fields.md:2: ## Inside'],
    ['a hash line with no space', '##unspaced', 'unsupported markdown: fields.md:2: ##unspaced'],
    ['a heading closed with hashes', '## Closed ##', 'unsupported markdown: fields.md:2: ## Closed ##'],
    ['a brace group the renderer keeps (no space before it)', '## Foo{: .x}', 'unsupported markdown: fields.md:2: ## Foo{: .x}'],
    ['an empty brace group', '## Foo {}', 'unsupported markdown: fields.md:2: ## Foo {}'],
    ['two brace groups', '## X {: #a } {: .b }', 'unsupported markdown: fields.md:2: ## X {: #a } {: .b }'],
    ['markup inside a brace group, which the renderer keeps', '## Show toolbar {*x*}', 'unsupported markdown: fields.md:2: ## Show toolbar {*x*}'],
    ['a class attribute list', '## Foo { .wide }', 'unsupported markdown: fields.md:2: ## Foo { .wide }'],
    ['emphasis in a heading', '## Foo *bar*', 'unsupported markdown: fields.md:2: ## Foo *bar*'],
    ['a code span in a heading', '## Foo `x`', 'unsupported markdown: fields.md:2: ## Foo `x`'],
    ['a link in a heading', '## [link](u)', 'unsupported markdown: fields.md:2: ## [link](u)'],
    ['an emoji shortcode in a heading', '## Foo :smile:', 'unsupported markdown: fields.md:2: ## Foo :smile:'],
  ])('reports %s, which could hide a heading from the reader', (_name, line, finding) => {
    const pages = [{ file: 'fields.md', markdown: `## A\n${line}\n` }];

    expect(unmodelledMarkdownFindings(pages)).toEqual([finding]);
  });

  it('reports front matter opening a page, which MkDocs strips before rendering', () => {
    const pages = [{ file: 'timeline.md', markdown: '---\ntitle: Timeline\n## Default Scale\n---\n\nProse.\n' }];

    expect(unmodelledMarkdownFindings(pages)).toEqual(['unsupported markdown: timeline.md:1: ---']);
  });

  it('reports front matter behind a byte-order mark', () => {
    const pages = [{ file: 'timeline.md', markdown: '\uFEFF---\ntitle: Timeline\n## Default Scale\n---\n' }];

    expect(unmodelledMarkdownFindings(pages)).toEqual(['unsupported markdown: timeline.md:1: ---']);
  });

  it('reports a setext heading, which the guard cannot read as a heading', () => {
    const pages = [{ file: 'appearance.md', markdown: '## A\n\nDefault Scale\n-------------\n' }];

    expect(unmodelledMarkdownFindings(pages)).toEqual(['unsupported markdown: appearance.md:4: -------------']);
  });

  it('turns a setext duplicate of a documented control into a finding', () => {
    const control = { group: 'Timeline', name: 'Default Scale', keys: ['tngantt_defaultScale'] };
    const pages = [
      { file: 'timeline.md', markdown: '## Default Scale\n' },
      { file: 'appearance.md', markdown: 'Default Scale\n=============\n' },
    ];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList: [] }).findings).toEqual([
      'unsupported markdown: appearance.md:2: =============',
    ]);
  });

  it('leaves a thematic break below the first line alone', () => {
    expect(unmodelledMarkdownFindings([{ file: 'fields.md', markdown: '## A\n\n---\n\n## B\n' }])).toEqual([]);
  });

  it('leaves headings, prose and admonitions alone', () => {
    const markdown = '## A\n\nProse with `a < b` and a [link](x.md).\n\n!!! note "N"\n\n    Indented text.\n';

    expect(unmodelledMarkdownFindings([{ file: 'fields.md', markdown }])).toEqual([]);
  });

  it('turns a control heading hidden in a raw HTML block into a finding', () => {
    const control = { group: 'Timeline', name: 'Default Scale', keys: ['tngantt_defaultScale'] };
    const pages = [{ file: 'timeline.md', markdown: '<pre>\n## Default Scale\n</pre>\n' }];

    expect(checkSettingsCoverage({ controls: [control], pages, allowList: [] }).findings).toEqual([
      'unsupported markdown: timeline.md:1: <pre>',
      'unsupported markdown: timeline.md:3: </pre>',
    ]);
  });
});

describe('check-settings-coverage CLI', () => {
  const script = resolve('scripts/check-settings-coverage.mjs');
  const scriptName = 'check-settings-coverage.mjs';
  // Each case starts a node process that loads Vite; start-up alone can pass jest's 5s default.
  jest.setTimeout(30_000);

  let scratch: string;
  let links: string[];
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'settings-coverage-'));
    links = [];
  });
  afterEach(() => {
    // Unlink first: the links point at the real src/, scripts/ and node_modules/,
    // and a recursive delete must never be trusted not to follow them.
    for (const link of links) unlinkSync(link);
    rmSync(scratch, { recursive: true, force: true });
  });

  function link(target: string, path: string): void {
    symlinkSync(resolve(target), path, 'junction');
    links.push(path);
  }

  function runScript(path: string): { status: number | null; stdout: string; stderr: string } {
    const run = spawnSync(process.execPath, [path], { encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  /** A throwaway checkout: a copy of the script and the settings pages, with the real sources and modules linked in. */
  function stageCheckout(mutatePage: (file: string, markdown: string) => string): string {
    mkdirSync(join(scratch, 'scripts'));
    copyFileSync(script, join(scratch, 'scripts', scriptName));
    link('node_modules', join(scratch, 'node_modules'));
    link('src', join(scratch, 'src'));
    const settings = join(scratch, 'website', 'docs', 'settings');
    mkdirSync(settings, { recursive: true });
    for (const page of readSettingsPages()) {
      writeFileSync(join(settings, page.file), mutatePage(page.file, page.markdown));
    }
    return join(scratch, 'scripts', scriptName);
  }

  it('exits 0 on the committed tree', () => {
    expect(runScript(script)).toEqual(
      expect.objectContaining({ status: 0, stdout: expect.stringContaining('each documented once') }),
    );
  });

  it('exits 1 and names the finding when a page is wrong', () => {
    const staged = stageCheckout((file, markdown) =>
      file === 'timeline.md' ? markdown.replace('## Default Scale', '## Scale') : markdown,
    );

    expect(runScript(staged)).toEqual(
      expect.objectContaining({ status: 1, stderr: expect.stringContaining('undocumented: Timeline › Default Scale') }),
    );
  });

  it('runs, rather than exiting 0 unrun, when invoked through a junction', () => {
    link('scripts', join(scratch, 'linked-scripts'));

    expect(runScript(join(scratch, 'linked-scripts', scriptName))).toEqual(
      expect.objectContaining({ status: 0, stdout: expect.stringContaining('each documented once') }),
    );
  });

  it('exits 2, not 0, when it cannot load the builders', () => {
    mkdirSync(join(scratch, 'scripts'));
    copyFileSync(script, join(scratch, 'scripts', scriptName));

    expect(runScript(join(scratch, 'scripts', scriptName))).toEqual(
      expect.objectContaining({ status: 2, stderr: expect.stringContaining('could not run') }),
    );
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
