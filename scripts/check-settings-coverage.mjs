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
 * @typedef {{ companionAvailable: boolean, hasProgressProperty: boolean, degraded: boolean, feedsPerProvider: number }} SettingsMatrixCell
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

const ATTRIBUTE_LIST = /\s*\{[^}]*\}\s*$/;
const HEADING = /^(#{2,3})\s+(.+?)\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * The page documenting a group: its display name in kebab case.
 *
 * @param {string} group
 */
export function settingsPageForGroup(group) {
  return `${group.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
}

/**
 * Level-2 and level-3 headings outside fenced code and HTML comments, with a
 * trailing MkDocs attribute list stripped. Nothing else is normalized:
 * matching is exact. A commented-out heading documents nothing.
 *
 * @param {SettingsPage[]} pages
 * @returns {SettingsHeading[]}
 */
export function parseSettingsHeadings(pages) {
  return pages.flatMap(headingsOnPage);
}

/**
 * A fence closes only on a bare run (no info string) of the same character at
 * least as long as the one that opened it, so a longer fence can quote a
 * shorter one.
 *
 * @param {string} line
 * @param {string} openFence
 */
function closesFence(line, openFence) {
  return CLOSING_FENCE.exec(line)?.[1].startsWith(openFence) === true;
}

/**
 * Whether a comment is still open at the end of `line`, given whether one was
 * open at its start: the last `<!--` or `-->` on the line decides.
 *
 * @param {string} line
 * @param {boolean} openAtStart
 */
function commentOpenAfter(line, openAtStart) {
  const lastOpen = line.lastIndexOf('<!--');
  const lastClose = line.lastIndexOf('-->');
  if (lastOpen === -1 && lastClose === -1) return openAtStart;
  return lastOpen > lastClose;
}

/**
 * Advance the fence/comment state by one line; the heading text on that line
 * when it is visible, otherwise null.
 *
 * @param {{ openFence: string | null, inComment: boolean }} state
 * @param {string} line
 * @returns {string | null}
 */
function visibleHeading(state, line) {
  if (state.openFence !== null) {
    if (closesFence(line, state.openFence)) state.openFence = null;
    return null;
  }
  if (state.inComment) {
    state.inComment = commentOpenAfter(line, true);
    return null;
  }
  state.openFence = FENCE.exec(line)?.[1] ?? null;
  state.inComment = state.openFence === null && commentOpenAfter(line, false);
  if (state.openFence !== null || state.inComment) return null;
  const match = HEADING.exec(line);
  return match ? match[2].replace(ATTRIBUTE_LIST, '').trim() : null;
}

/**
 * @param {SettingsPage} page
 * @returns {SettingsHeading[]}
 */
function headingsOnPage(page) {
  const state = { openFence: null, inComment: false };
  const headings = [];
  for (const line of page.markdown.split(/\r?\n/)) {
    const text = visibleHeading(state, line);
    if (text !== null) headings.push({ file: page.file, text });
  }
  return headings;
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
  const last = segments[segments.length - 1].split(' ');
  const prefix = first.slice(0, -1);
  const suffix = last.slice(1);
  const variants = [first[first.length - 1], ...middle, last[0]];
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
 * `count` synthetic feeds per provider. ICS feeds are subscriptions; every
 * other provider serves calendars.
 *
 * @param {readonly string[]} providerOrder
 * @param {number} count
 * @returns {ExternalFeeds}
 */
export function feedsPerProvider(providerOrder, count) {
  /** @type {ExternalFeeds} */
  const feeds = { subscriptions: [], calendars: [] };
  for (const kind of providerOrder) {
    for (let index = 0; index < count; index++) {
      const feed = { id: coverageFeedId(kind, index), name: `${kind} coverage feed ${index}` };
      if (kind === 'ics') feeds.subscriptions.push({ ...feed, enabled: true });
      else feeds.calendars.push({ ...feed, provider: kind });
    }
  }
  return feeds;
}

/**
 * Every combination of the callback's inputs: TaskNotes present or not, a
 * Progress Property mapped or not, the session's external-calendar degrade
 * flag set or clear, and none, one or many feeds per provider.
 *
 * @returns {SettingsMatrixCell[]}
 */
export function settingsArgumentMatrix() {
  const cells = [];
  for (const companionAvailable of [true, false]) {
    for (const hasProgressProperty of [true, false]) {
      for (const degraded of [false, true]) {
        for (let feedCount = 0; feedCount <= MAX_FEEDS_PER_PROVIDER; feedCount++) {
          cells.push({ companionAvailable, hasProgressProperty, degraded, feedsPerProvider: feedCount });
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
    const feeds = feedsPerProvider(builders.EXTERNAL_PROVIDER_ORDER, cell.feedsPerProvider);
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
  for (const cell of settingsArgumentMatrix()) {
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
