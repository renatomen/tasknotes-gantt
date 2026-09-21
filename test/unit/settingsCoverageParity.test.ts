import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BasesViewConfig } from 'obsidian';
import {
  composeRegisteredOptions,
  optionTriples,
  settingsArgumentMatrix,
  syntheticFeeds,
  type ExternalFeeds,
  type SettingsMatrixCell,
} from '../../scripts/check-settings-coverage.mjs';
import { captureOptionsCallback } from '../helpers/captureOptionsCallback';
import { SETTINGS_BUILDERS as BUILDERS } from '../helpers/settingsCoverageBuilders';
import { sessionExternalCalendarDegradeSignal } from '../../src/bases/externalCalendarDegradeNotice';
import { FIELD_MAPPING_KEYS, readFieldMappings } from '../../src/bases/fieldMappingConfig';
import { EXTERNAL_PROVIDER_ORDER, externalCalendarToggleKey } from '../../src/bases/calendarItemOptions';
import { TOOLBAR_PERSISTED_CONTROLS } from '../../src/bases/themeResolver';

/**
 * The coverage script cannot see register.ts's options callback: it recomposes
 * the same builders from outside. This suite captures the REAL callback and
 * requires its output to equal the script's composition over the script's own
 * argument matrix, so a control added to the callback directly — or moved,
 * duplicated or reordered there — fails here instead of escaping the guard.
 */

/** A TaskNotes handle serving `feeds`; `degraded` adds a malformed provider the guarded read rejects. */
function taskNotesHandleServing(feeds: ExternalFeeds, degraded: boolean): Record<string, unknown> {
  const providerKinds = [...new Set(feeds.calendars.map((calendar) => calendar.provider))];
  const providers: unknown[] = providerKinds.map((kind) => ({
    providerId: kind,
    getAllEvents: () => [],
    getAvailableCalendars: () =>
      feeds.calendars
        .filter((calendar) => calendar.provider === kind)
        .map((calendar) => ({ id: calendar.id, summary: calendar.name })),
  }));
  if (degraded) providers.push({ providerId: 'unrecognized' });
  return {
    api: {},
    icsSubscriptionService: { getSubscriptions: () => feeds.subscriptions, getAllEvents: () => [] },
    calendarProviderRegistry: { getAllProviders: () => providers },
  };
}

const OTHER_MAPPING_KEYS: readonly string[] = Object.values(FIELD_MAPPING_KEYS).filter(
  (key) => key !== FIELD_MAPPING_KEYS.progress,
);

/**
 * Every subset of the non-progress field mappings, as the set of keys mapped.
 * The composition must not depend on them, and presence is all a principled
 * gate can test: gating on one specific property value would hardcode a
 * property name.
 */
function everyMappingSubset(): Set<string>[] {
  return Array.from(
    { length: 2 ** OTHER_MAPPING_KEYS.length },
    (_, mask) => new Set(OTHER_MAPPING_KEYS.filter((_key, bit) => (mask >> bit) & 1)),
  );
}

/**
 * A view config recording into `reads` every key passed to `get` and every
 * other member touched at all, so no way of reading it goes unseen. The
 * Progress Property follows the matrix cell; the other field mappings are
 * mapped exactly when they are in `mapped`.
 */
function viewConfig(hasProgressProperty: boolean, mapped: Set<string>, reads: Set<string>): BasesViewConfig {
  const get = (key: string): unknown => {
    reads.add(key);
    if (key === FIELD_MAPPING_KEYS.progress) return hasProgressProperty ? 'note.progress' : undefined;
    return mapped.has(key) ? `note.${key}` : undefined;
  };
  return new Proxy({} as BasesViewConfig, {
    get: (_target, member) => {
      if (member === 'get') return get;
      reads.add(`member:${String(member)}`);
      return undefined;
    },
  });
}

/** The config keys the field-mapping reader consults: the only config the matrix accounts for. */
function fieldMappingKeys(): string[] {
  const reads = new Set<string>();
  readFieldMappings((key) => {
    reads.add(key);
    return undefined;
  });
  return [...reads].sort((a, b) => a.localeCompare(b));
}

const ONE_FEED_EACH = Object.fromEntries(EXTERNAL_PROVIDER_ORDER.map((kind) => [kind, 1]));

interface ParityCase {
  cell: SettingsMatrixCell;
  mappings: Set<string>[];
}

/**
 * Every matrix cell with the other field mappings all unset and all set, and
 * every subset of those mappings in each companion/progress/degraded cell with
 * one feed per provider. A control gated jointly on a mixed mapping subset and
 * an uneven feed count is between the two walks; the parity test detects drift
 * in the callback, and the backlog's extraction of its assembly is what would
 * prevent it.
 */
function parityCases(): ParityCase[] {
  const subsets = everyMappingSubset();
  const noneAndAll = [subsets[0], subsets[subsets.length - 1]];
  const matrix = settingsArgumentMatrix(EXTERNAL_PROVIDER_ORDER);
  const everyCell = matrix.map((cell) => ({ cell, mappings: noneAndAll }));
  const baseCells = matrix
    .filter((cell) => EXTERNAL_PROVIDER_ORDER.every((kind) => cell.feedCounts[kind] === 1))
    .map((cell) => ({ cell, mappings: subsets }));
  const cases = [...everyCell, ...baseCells];
  // The session degrade flag is sticky: every clear case must run before the first degraded one.
  return [...cases.filter(({ cell }) => !cell.degraded), ...cases.filter(({ cell }) => cell.degraded)];
}

function cellName(cell: SettingsMatrixCell): string {
  return (
    `companion=${cell.companionAvailable} progress=${cell.hasProgressProperty} ` +
    `degraded=${cell.degraded} feeds=${JSON.stringify(cell.feedCounts)}`
  );
}

describe('settings-coverage parity with the registered options callback', () => {
  it('assigns none, one or many feeds to each provider independently', () => {
    const cells = settingsArgumentMatrix(EXTERNAL_PROVIDER_ORDER);
    const perProvider = 3 ** EXTERNAL_PROVIDER_ORDER.length;

    expect(cells).toHaveLength(8 * perProvider);
    expect(cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feedCounts: Object.fromEntries(EXTERNAL_PROVIDER_ORDER.map((kind, i) => [kind, i % 3])) }),
      ]),
    );
  });

  it('serves the requested number of feeds to each provider', () => {
    const counts = Object.fromEntries(EXTERNAL_PROVIDER_ORDER.map((kind, i) => [kind, i % 3]));
    const feeds = syntheticFeeds(counts);
    const served = [...feeds.subscriptions.map(() => 'ics'), ...feeds.calendars.map((calendar) => calendar.provider)];
    const expected = EXTERNAL_PROVIDER_ORDER.flatMap((kind) => Array.from({ length: counts[kind] }, () => kind));

    expect([...served].sort()).toEqual([...expected].sort());
  });

  // Both claims are checked in one pass because the session degrade flag is
  // sticky: only this ordered walk visits every case in its real state. It
  // calls the real callback thousands of times, so it outgrows jest's 5s default.
  it('the registered callback emits the composed controls, reading no config beyond the field mappings, in every case', () => {
    const reads = new Set<string>();
    for (const { cell, mappings } of parityCases()) {
      if (!cell.degraded) {
        expect(sessionExternalCalendarDegradeSignal.wasDegradedThisSession()).toBe(false);
      }
      const composed = optionTriples(composeRegisteredOptions(BUILDERS, cell));
      const feeds = syntheticFeeds(cell.feedCounts);
      const options = captureOptionsCallback(cell.companionAvailable ? taskNotesHandleServing(feeds, cell.degraded) : null);
      for (const mapped of mappings) {
        const registered = optionTriples(options(viewConfig(cell.hasProgressProperty, mapped, reads)));
        const name = `${cellName(cell)} mapped=[${[...mapped].join(', ')}]`;

        expect({ cell: name, triples: registered }).toEqual({ cell: name, triples: composed });
      }
    }

    expect([...reads].sort((a, b) => a.localeCompare(b))).toEqual(fieldMappingKeys());
  }, 60_000);

  it('a composed cell with feeds carries a toggle for every provider', () => {
    const composed = composeRegisteredOptions(BUILDERS, {
      companionAvailable: true,
      hasProgressProperty: false,
      degraded: false,
      feedCounts: ONE_FEED_EACH,
    });
    const keys = optionTriples(composed).map((triple) => triple.key);

    for (const kind of EXTERNAL_PROVIDER_ORDER) {
      expect(keys.some((key) => key.startsWith(externalCalendarToggleKey(kind, '')))).toBe(true);
    }
  });
});

/**
 * Source-shape pins on GanttToolbar.svelte. Its imports are type-only and it
 * neither binds props nor dispatches events or shares context, so the only way
 * a value leaves it is a callback prop. Every callback prop is therefore the
 * `changeProp` of a TOOLBAR_PERSISTED_CONTROLS entry or declared here as not
 * persisting anything, whatever it is named and however it is marked up.
 */
const NON_PERSISTING_TOOLBAR_CALLBACKS: Record<string, string> = {
  onOpenSourceSwitcher: 'opens the quick source switcher, whose hidden sources are session state',
};

/** Members of the toolbar's Props interface whose type is a function. */
function callbackProps(source: string): string[] {
  const props = /interface Props \{([\s\S]*?)\n {2}\}/.exec(source)?.[1] ?? '';
  return [...props.matchAll(/^\s*(\w+)\??\s*:\s*\(/gm)].map((match) => match[1]);
}

/** Every way besides a callback prop that a Svelte component can hand a value out. */
function otherOutputChannels(source: string): string[] {
  const channels = [
    ...[...source.matchAll(/^\s*import\s+(?!type\b)[^\n]*/gm)].map((match) => match[0].trim()),
  ];
  for (const marker of ['$bindable', 'createEventDispatcher', 'setContext', 'getContext']) {
    if (source.includes(marker)) channels.push(marker);
  }
  return channels;
}

/** The labels the toolbar renders for its labelled control groups. */
function renderedToolbarLabels(source: string): string[] {
  return [...source.matchAll(/<[^>]*\bog-toolbar-label\b[^>]*>([^<]+)</g)].map((match) => match[1].trim());
}

describe('TOOLBAR_PERSISTED_CONTROLS against the toolbar', () => {
  const toolbar = readFileSync(resolve('src/bases/GanttToolbar.svelte'), 'utf8');
  const persistedProps = TOOLBAR_PERSISTED_CONTROLS.map((control) => control.changeProp);

  it('hands values out through callback props only', () => {
    expect(otherOutputChannels(toolbar)).toEqual([]);
  });

  it('classifies every callback prop as a persisted control or as persisting nothing', () => {
    const callbacks = callbackProps(toolbar);

    expect(callbacks.length).toBeGreaterThan(0);
    expect([...callbacks].sort((a, b) => a.localeCompare(b))).toEqual(
      [...persistedProps, ...Object.keys(NON_PERSISTING_TOOLBAR_CALLBACKS)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('carries the label the toolbar renders for each labelled control group', () => {
    expect(renderedToolbarLabels(toolbar)).toEqual(TOOLBAR_PERSISTED_CONTROLS.map((control) => control.uiLabel));
  });

  it('the classification sees a new callback prop, whatever its name', () => {
    const anchor = '    onModeChange: (mode: ThemeMode) => void;';
    expect(toolbar).toContain(anchor);
    const planted = toolbar.replace(anchor, `${anchor}\n    onDensitySelect?: (density: string) => void;`);

    expect(callbackProps(planted)).toContain('onDensitySelect');
  });

  it('the channel pin sees a value import and a bindable prop', () => {
    const anchor = "  import type { ThemeMode } from './themeResolver';";
    expect(toolbar).toContain(anchor);
    const planted = toolbar
      .replace(anchor, `${anchor}\n  import { persistThemeMode } from './themeResolver';`)
      .replace('$props()', '$props(); let density = $bindable()');

    expect(otherOutputChannels(planted)).toEqual([
      "import { persistThemeMode } from './themeResolver';",
      '$bindable',
    ]);
  });

  it('the label pin sees a labelled group carrying extra attributes', () => {
    const anchor = '<span class="og-toolbar-label">Theme</span>';
    expect(toolbar).toContain(anchor);
    const planted = toolbar.replace(anchor, `${anchor}<span class="og-toolbar-label" title="Density">Density</span>`);

    expect(renderedToolbarLabels(planted)).toEqual(['Theme', 'Density']);
  });
});
