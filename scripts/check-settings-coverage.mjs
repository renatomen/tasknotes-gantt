#!/usr/bin/env node
/**
 * Settings-coverage guard: every shipped view-option control is documented by
 * exactly one heading, on the settings page of its own group, and every
 * settings-page heading is either a control or an allow-listed non-control.
 *
 * The inventory is what `registerBasesGantt`'s `options` callback returns
 * (src/bases/register.ts, the `options:` entry of the registerBasesView call),
 * recomposed here from the same exported builders in the same order across
 * the whole argument matrix, plus the toolbar-persisted controls that never
 * pass through that callback. This mirrors the callback rather than calling
 * it; test/unit/settingsCoverageParity.test.ts is what fails when the two
 * drift apart.
 *
 * Usage: node scripts/check-settings-coverage.mjs
 * Exit codes: 0 covered, 1 findings, 2 the guard could not run.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_DIR = join(repoRoot, 'website', 'docs', 'settings');

/**
 * @typedef {{ file: string, markdown: string }} SettingsPage
 * @typedef {{ file: string, text: string }} SettingsHeading
 * @typedef {{ group: string, name: string, keys: string[], renderedInPanel?: number }} ShippedControl
 * @typedef {{ page: string, heading: string }} AllowedHeading
 * @typedef {{ id: string, name: string, enabled: boolean }} IcsFeed
 * @typedef {{ provider: string, id: string, name: string }} ProviderFeed
 * @typedef {{ subscriptions: IcsFeed[], calendars: ProviderFeed[] }} ExternalFeeds
 * @typedef {{ companionAvailable: boolean, hasProgressProperty: boolean, degraded: boolean, feedCounts: Record<string, number> }} SettingsMatrixCell
 * @typedef {{ displayName?: string, key?: string, type?: string, items?: OptionEntry[] }} OptionEntry
 * @typedef {{
 *   ganttViewOptions: (companionAvailable: boolean, hasProgressProperty: boolean) => any[],
 *   calendarItemOptionsGroup: () => any,
 *   externalCalendarOptionEntries: (subscriptions: any[], calendars: any[]) => any[],
 *   externalCalendarDegradedEntry: () => any,
 *   externalCalendarToggleKey: (kind: any, id: string) => string,
 *   EXTERNAL_PROVIDER_ORDER: readonly string[],
 *   TOOLBAR_PERSISTED_CONTROLS: readonly { uiLabel: string, docHeading: string, group: string }[],
 * }} SettingsBuilders
 */

/**
 * Settings-page headings that are not controls. Every entry names the page it
 * lives on and why it is not a control; an entry whose heading is gone is
 * itself a finding, so this list cannot silently outlive its reasons.
 *
 * @type {readonly AllowedHeading[]}
 */
export const NON_CONTROL_HEADINGS = [
  // Orientation: lists the option groups, one per settings page.
  { page: 'index.md', heading: 'The groups' },
  // Orientation: which controls need the TaskNotes companion.
  { page: 'index.md', heading: 'Companion vs. standalone' },
  // Documents session state that is deliberately not a view option.
  { page: 'calendar-items.md', heading: 'Not a view setting: the quick source switcher' },
  // Cross-links to feature pages.
  { page: 'calendar-items.md', heading: 'Related' },
];

/**
 * The one attribute-list form the guard strips: a single plain `{ #id }`
 * (optionally `{: #id }`), which attr_list always removes from a heading.
 * A heading carrying any other brace group is refused, not guessed at.
 */
const ATTRIBUTE_LIST_BODY = /^\{:? *#[\w-]+ *\}$/;
/**
 * Inline syntax the renderer would transform (braces, emphasis, code, links,
 * HTML, entities, escapes, mark/keys/emoji extensions), control or format
 * characters, or whitespace other than a plain space: a heading carrying any
 * of it does not render as the literal text the guard reads, so it is refused.
 */
const INLINE_SYNTAX = /[{}*_`[\]<>&\\~^\p{Cc}\p{Cf}]|[^\S ]|==|\+\+|:[+\-\w]+:/u;
/** The opening of an ATX heading at column 0: one to six hashes, then a space or tab. */
const ATX_OPENING = /^(#{1,6})[ \t]/;
/**
 * A fence, a raw HTML block or a blockquote at any indentation (a container
 * body can nest one), a footnote definition (its body may follow the colon
 * unspaced), or raw HTML anywhere on the line (an inline `<h2>` renders a
 * heading; a comment can hide one).
 */
const UNMODELLED_MARKDOWN = /(?:^[ \t]*(?:`{3,}|~{3,}|<|>))|(?:^ {0,3}\[\^[^\]]*\]:)|(?:<[A-Za-z/!?])/;
/** Any control character but a tab: the renderer may normalize it into structure the guard does not see. */
const CONTROL_CHARACTER = /[^\P{Cc}\t]/u;
/** A Markdown link target, where a `#` is a URL fragment and never a heading. */
const LINK_TARGET = /\]\([^)\s]*\)/g;
/** A setext underline; under a line of text it can turn that line into a heading. */
const SETEXT_UNDERLINE = /^[ \t]*(=+|-+)[ \t]*$/;
/**
 * YAML front matter, which MkDocs strips before rendering: it can only open a
 * page, after an optional byte-order mark (MkDocs reads pages as utf-8-sig).
 */
const FRONT_MATTER = /^\uFEFF?---[ \t]*$/;

/**
 * The page documenting a group: its display name in kebab case.
 *
 * @param {string} group
 */
export function settingsPageForGroup(group) {
  return `${group.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
}

/**
 * Lines as the renderer sees them: Python-Markdown turns a lone CR, like CRLF,
 * into a line break before it reads a block.
 *
 * @param {string} markdown
 */
function splitLines(markdown) {
  return markdown.split(/\r\n|\r|\n/);
}

/**
 * Level-2 and level-3 ATX headings, with a trailing MkDocs attribute list
 * stripped. Nothing else is normalized: matching is exact. This is not a
 * Markdown parser: pages carrying anything that could hide a heading from the
 * reader are refused by {@link unmodelledMarkdownFindings} instead.
 *
 * @param {SettingsPage[]} pages
 * @returns {SettingsHeading[]}
 */
export function parseSettingsHeadings(pages) {
  return pages.flatMap((page) =>
    splitLines(page.markdown).flatMap((line) => {
      const text = headingText(line);
      return text === null ? [] : [{ file: page.file, text }];
    }),
  );
}

/**
 * Strip spaces and tabs only: String#trim also removes format characters such
 * as U+FEFF, which the refusal must still see.
 *
 * @param {string} text
 */
function trimBlanks(text) {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === ' ' || text[start] === '\t')) start++;
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return text.slice(start, end);
}

/**
 * A canonical ATX heading: column 0, one to six hashes, a space, then text
 * not ending in `#`. The site's renderer (Python-Markdown) always renders it
 * as a heading; every other hash- or underline-shaped line is refused by
 * {@link unmodelledMarkdownFindings} rather than interpreted.
 *
 * @param {string} line
 * @returns {{ level: number, text: string } | null}
 */
function canonicalAtx(line) {
  const opening = ATX_OPENING.exec(line);
  if (!opening) return null;
  const text = trimBlanks(line.slice(opening[0].length));
  if (text === '' || text.endsWith('#')) return null;
  return { level: opening[1].length, text };
}

/**
 * The text of a canonical level-2/3 heading line, its attribute list removed;
 * null for any other line.
 *
 * @param {string} line
 * @returns {string | null}
 */
function headingText(line) {
  const heading = canonicalAtx(line);
  if (heading === null || heading.level < 2 || heading.level > 3) return null;
  return stripAttributeList(heading.text);
}

/**
 * `text` without its trailing `{ #id }` attribute list, when it has exactly
 * that one plain form; unchanged otherwise, so the refusal sees any brace.
 *
 * @param {string} text
 */
function stripAttributeList(text) {
  const open = text.lastIndexOf(' {');
  if (open === -1 || !ATTRIBUTE_LIST_BODY.test(text.slice(open + 1))) return text;
  const stripped = trimBlanks(text.slice(0, open));
  // attr_list also strips trailing hashes once the list is gone; refuse rather than mirror that.
  return stripped === '' || stripped.endsWith('#') ? text : stripped;
}

/**
 * Settings pages carry their title as the first line, at level 1, and every
 * other heading at level 2 or 3. Any other level renders a heading the guard
 * does not read, so it could hide a duplicate or a stale control.
 *
 * @param {number} level
 * @param {string[]} lines
 * @param {number} index
 */
function isReadLevel(level, lines, index) {
  if (level === 2 || level === 3) return true;
  return level === 1 && lines.slice(0, index).every((line) => trimBlanks(line) === '');
}

/**
 * Whether `line` is Markdown the guard does not read: inside a fence, an HTML
 * comment, a raw HTML block or front matter a heading-shaped line may not
 * render as a heading, and a setext underline makes a heading out of a line
 * the guard reads as prose.
 *
 * @param {string[]} lines
 * @param {number} index
 */
function isUnmodelled(lines, index) {
  const line = lines[index];
  if (UNMODELLED_MARKDOWN.test(line) || CONTROL_CHARACTER.test(line)) return true;
  const heading = canonicalAtx(line);
  // Outside a canonical heading, a `#` anywhere but a link target may be a
  // heading the renderer shows from inside some container the guard does not read.
  if (heading === null && line.replace(LINK_TARGET, '').includes('#')) return true;
  if (heading !== null && !isReadLevel(heading.level, lines, index)) return true;
  if (INLINE_SYNTAX.test(headingText(line) ?? '')) return true;
  if (index === 0) return FRONT_MATTER.test(line);
  const above = lines[index - 1];
  return SETEXT_UNDERLINE.test(line) && trimBlanks(above) !== '' && canonicalAtx(above) === null;
}

/**
 * Each line the guard does not read is a finding: settings pages are ATX
 * headings and prose, and anything else could hide a heading from the reader
 * or show one the guard cannot see.
 *
 * @param {SettingsPage[]} pages
 * @returns {string[]}
 */
export function unmodelledMarkdownFindings(pages) {
  return pages.flatMap((page) => {
    const lines = splitLines(page.markdown);
    return lines.flatMap((line, index) =>
      isUnmodelled(lines, index) ? [`unsupported markdown: ${page.file}:${index + 1}: ${line.trim()}`] : [],
    );
  });
}

/**
 * The control names one heading documents. A collapsed heading such as
 * `Event start / end / title property` shares the words before its first
 * variant and after its last, and documents one name per variant. Any other
 * heading documents itself.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function expandHeading(text) {
  const segments = text.split(' / ');
  if (segments.length < 2) return [text];
  const middle = segments.slice(1, -1);
  if (middle.some((segment) => segment.includes(' '))) return [text];
  const first = segments[0].split(' ');
  const last = segments.at(-1).split(' ');
  const prefix = first.slice(0, -1);
  const suffix = last.slice(1);
  const variants = [first.at(-1), ...middle, last[0]];
  return variants.map((variant) => [...prefix, variant, ...suffix].join(' '));
}

/** The most synthetic feeds any cell gives one provider: none, one, and many. */
const MAX_FEEDS_PER_PROVIDER = 2;

/**
 * @param {string} kind
 * @param {number} index
 */
function coverageFeedId(kind, index) {
  return `${kind}-coverage-feed-${index}`;
}

/**
 * Synthetic feeds, `feedCounts[kind]` of them for each provider. ICS feeds are
 * subscriptions; every other provider serves calendars.
 *
 * @param {Record<string, number>} feedCounts
 * @returns {ExternalFeeds}
 */
export function syntheticFeeds(feedCounts) {
  /** @type {ExternalFeeds} */
  const feeds = { subscriptions: [], calendars: [] };
  for (const [kind, count] of Object.entries(feedCounts)) {
    for (let index = 0; index < count; index++) {
      const feed = { id: coverageFeedId(kind, index), name: `${kind} coverage feed ${index}` };
      if (kind === 'ics') feeds.subscriptions.push({ ...feed, enabled: true });
      else feeds.calendars.push({ ...feed, provider: kind });
    }
  }
  return feeds;
}

/**
 * Every assignment of none, one or many feeds to each provider independently.
 *
 * @param {readonly string[]} providerOrder
 * @returns {Record<string, number>[]}
 */
function everyFeedCount(providerOrder) {
  /** @type {Record<string, number>[]} */
  let assignments = [{}];
  for (const kind of providerOrder) {
    assignments = assignments.flatMap((assignment) =>
      Array.from({ length: MAX_FEEDS_PER_PROVIDER + 1 }, (_, count) => ({ ...assignment, [kind]: count })),
    );
  }
  return assignments;
}

/**
 * Every combination of the callback's inputs: TaskNotes present or not, a
 * Progress Property mapped or not, the session's external-calendar degrade
 * flag set or clear, and none, one or many feeds for each provider
 * independently.
 *
 * @param {readonly string[]} providerOrder
 * @returns {SettingsMatrixCell[]}
 */
export function settingsArgumentMatrix(providerOrder) {
  const cells = [];
  for (const companionAvailable of [true, false]) {
    for (const hasProgressProperty of [true, false]) {
      for (const degraded of [false, true]) {
        for (const feedCounts of everyFeedCount(providerOrder)) {
          cells.push({ companionAvailable, hasProgressProperty, degraded, feedCounts });
        }
      }
    }
  }
  return cells;
}

/**
 * What the registered `options` callback returns for one matrix cell,
 * assembled the way it assembles it.
 *
 * @param {SettingsBuilders} builders
 * @param {SettingsMatrixCell} cell
 */
export function composeRegisteredOptions(builders, cell) {
  const calendarItems = builders.calendarItemOptionsGroup();
  if (cell.companionAvailable) {
    const feeds = syntheticFeeds(cell.feedCounts);
    calendarItems.items.push(...builders.externalCalendarOptionEntries(feeds.subscriptions, feeds.calendars));
    if (cell.degraded) calendarItems.items.push(builders.externalCalendarDegradedEntry());
  }
  return [...builders.ganttViewOptions(cell.companionAvailable, cell.hasProgressProperty), calendarItems];
}

/**
 * `(group, control, key)` for every control, in panel order. A top-level
 * entry that is not a group is reported under an empty group name, which no
 * settings page can own.
 *
 * @param {OptionEntry[]} options
 * @returns {{ group: string, name: string, key: string }[]}
 */
export function optionTriples(options) {
  const triples = [];
  for (const entry of options) {
    if (entry.type === 'group') {
      for (const item of entry.items ?? []) {
        triples.push({ group: entry.displayName ?? '', name: item.displayName ?? '', key: item.key ?? '' });
      }
    } else {
      triples.push({ group: '', name: entry.displayName ?? '', key: entry.key ?? '' });
    }
  }
  return triples;
}

/**
 * The shipped controls: the union over the argument matrix, minus the per-feed
 * toggles of the synthetic feeds (labelled with the user's own feed names),
 * plus the toolbar-persisted controls. Each control carries every key seen
 * under its label and the most times its label renders in one panel, so two
 * controls sharing one label stay visible even when they share a key too.
 *
 * @param {SettingsBuilders} builders
 * @returns {ShippedControl[]}
 */
export function settingsInventory(builders) {
  const perFeedKeys = new Set(
    builders.EXTERNAL_PROVIDER_ORDER.flatMap((kind) =>
      Array.from({ length: MAX_FEEDS_PER_PROVIDER }, (_, index) =>
        builders.externalCalendarToggleKey(kind, coverageFeedId(kind, index)),
      ),
    ),
  );
  /** @type {Map<string, ShippedControl>} */
  const seen = new Map();
  const add = (group, name, key, renderedInPanel) => {
    const id = `${group}\u0000${name}`;
    const control = seen.get(id) ?? { group, name, keys: [], renderedInPanel: 0 };
    if (!control.keys.includes(key)) control.keys.push(key);
    control.renderedInPanel = Math.max(control.renderedInPanel, renderedInPanel);
    seen.set(id, control);
  };
  for (const cell of settingsArgumentMatrix(builders.EXTERNAL_PROVIDER_ORDER)) {
    const renders = new Map();
    for (const triple of optionTriples(composeRegisteredOptions(builders, cell))) {
      if (perFeedKeys.has(triple.key)) continue;
      const id = `${triple.group}\u0000${triple.name}`;
      renders.set(id, (renders.get(id) ?? 0) + 1);
      add(triple.group, triple.name, triple.key, renders.get(id));
    }
  }
  for (const control of builders.TOOLBAR_PERSISTED_CONTROLS) {
    add(control.group, control.docHeading, `toolbar:${control.uiLabel}`, 1);
  }
  return [...seen.values()];
}

/**
 * One label, one control: a heading cannot tell two same-labelled controls apart.
 *
 * @param {ShippedControl[]} controls
 * @returns {string[]}
 */
function sharedLabelFindings(controls) {
  return controls
    .map((control) => ({ control, count: Math.max(control.keys.length, control.renderedInPanel ?? 1) }))
    .filter(({ count }) => count > 1)
    .map(
      ({ control, count }) =>
        `shared label: ${control.group} › ${control.name} names ${count} controls (${control.keys.join(', ')})`,
    );
}

/**
 * @param {ShippedControl[]} controls
 * @param {SettingsPage[]} pages
 * @returns {string[]}
 */
function missingPageFindings(controls, pages) {
  const pageFiles = new Set(pages.map((page) => page.file));
  const groups = [...new Set(controls.map((control) => control.group))];
  return groups
    .filter((group) => !pageFiles.has(settingsPageForGroup(group)))
    .map((group) => `no settings page for group "${group}" (expected ${settingsPageForGroup(group)})`);
}

/**
 * Exactly one heading, on the page of the control's own group. A heading on
 * the page of another group that has a control of the same name belongs to
 * that control, not this one.
 *
 * @param {ShippedControl} control
 * @param {SettingsHeading[]} controlHeadings
 * @param {ShippedControl[]} controls
 * @returns {string[]}
 */
function placementFindings(control, controlHeadings, controls) {
  const label = `${control.group} › ${control.name}`;
  const expected = settingsPageForGroup(control.group);
  const namesakePages = new Set(
    controls
      .filter((other) => other.name === control.name && other.group !== control.group)
      .map((other) => settingsPageForGroup(other.group)),
  );
  const matches = controlHeadings.filter(
    (heading) => expandHeading(heading.text).includes(control.name) && !namesakePages.has(heading.file),
  );
  if (matches.length === 0) return [`undocumented: ${label}`];
  if (matches.length > 1) {
    return [`duplicated: ${label} has ${matches.length} headings (${matches.map((m) => m.file).join(', ')})`];
  }
  if (matches[0].file !== expected) return [`misfiled: ${label} is on ${matches[0].file}, expected ${expected}`];
  return [];
}

/**
 * @param {SettingsHeading[]} headings
 * @param {SettingsHeading[]} controlHeadings
 * @param {readonly AllowedHeading[]} allowList
 * @returns {string[]}
 */
function unknownHeadingFindings(headings, controlHeadings, allowList) {
  const isAllowed = (heading) =>
    allowList.some((entry) => entry.page === heading.file && entry.heading === heading.text);
  return headings
    .filter((heading) => !controlHeadings.includes(heading) && !isAllowed(heading))
    .map((heading) => `unknown heading: ${heading.file}: ${heading.text}`);
}

/**
 * @param {SettingsHeading[]} headings
 * @param {readonly AllowedHeading[]} allowList
 * @returns {string[]}
 */
function staleAllowListFindings(headings, allowList) {
  return allowList
    .filter((entry) => !headings.some((heading) => heading.file === entry.page && heading.text === entry.heading))
    .map((entry) => `stale allow-list entry: ${entry.page}: ${entry.heading}`);
}

/**
 * @param {{ controls: ShippedControl[], pages: SettingsPage[], allowList?: readonly AllowedHeading[] }} input
 * @returns {{ findings: string[] }}
 */
export function checkSettingsCoverage({ controls, pages, allowList = NON_CONTROL_HEADINGS }) {
  if (controls.length === 0) throw new Error('no shipped controls in the inventory');
  if (pages.length === 0) throw new Error('no settings pages to check');

  const controlNames = new Set(controls.map((control) => control.name));
  const headings = parseSettingsHeadings(pages);
  const controlHeadings = headings.filter((heading) =>
    expandHeading(heading.text).every((name) => controlNames.has(name)),
  );
  return {
    findings: [
      ...unmodelledMarkdownFindings(pages),
      ...missingPageFindings(controls, pages),
      ...sharedLabelFindings(controls),
      ...controls.flatMap((control) => placementFindings(control, controlHeadings, controls)),
      ...unknownHeadingFindings(headings, controlHeadings, allowList),
      ...staleAllowListFindings(headings, allowList),
    ],
  };
}

/** @returns {SettingsPage[]} */
export function readSettingsPages() {
  return readdirSync(SETTINGS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({ file, markdown: readFileSync(join(SETTINGS_DIR, file), 'utf8') }));
}

/**
 * Load the builders from TypeScript source through Vite's module runner; the
 * repo's Vite config is not loaded, so the build's vault-install hook never runs.
 *
 * @returns {Promise<SettingsBuilders>}
 */
async function loadBuilders() {
  const { runnerImport } = await import('vite');
  const source = async (path) => (await runnerImport(join(repoRoot, path), { configFile: false })).module;
  const [viewOptions, calendarItemOptions, themeResolver] = await Promise.all([
    source('src/bases/viewOptions.ts'),
    source('src/bases/calendarItemOptions.ts'),
    source('src/bases/themeResolver.ts'),
  ]);
  return {
    ganttViewOptions: viewOptions.ganttViewOptions,
    calendarItemOptionsGroup: calendarItemOptions.calendarItemOptionsGroup,
    externalCalendarOptionEntries: calendarItemOptions.externalCalendarOptionEntries,
    externalCalendarDegradedEntry: calendarItemOptions.externalCalendarDegradedEntry,
    externalCalendarToggleKey: calendarItemOptions.externalCalendarToggleKey,
    EXTERNAL_PROVIDER_ORDER: calendarItemOptions.EXTERNAL_PROVIDER_ORDER,
    TOOLBAR_PERSISTED_CONTROLS: themeResolver.TOOLBAR_PERSISTED_CONTROLS,
  };
}

async function main() {
  const controls = settingsInventory(await loadBuilders());
  const { findings } = checkSettingsCoverage({ controls, pages: readSettingsPages() });
  if (findings.length > 0) {
    console.error(`Settings coverage: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  ${finding}`);
    return 1;
  }
  console.log(`Settings coverage: ${controls.length} controls, each documented once on its group's page.`);
  return 0;
}

// Node reports this module at its real path while argv keeps any symlink or
// junction the caller used, so compare real paths or the gate exits 0 unrun.
const isDirectRun =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Settings coverage could not run: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
