import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BasesViewConfig } from 'obsidian';
import {
  composeRegisteredOptions,
  oneFeedPerProvider,
  optionTriples,
  settingsArgumentMatrix,
  type ExternalFeeds,
  type SettingsMatrixCell,
} from '../../scripts/check-settings-coverage.mjs';
import { captureOptionsCallback } from '../helpers/captureOptionsCallback';
import { SETTINGS_BUILDERS as BUILDERS } from '../helpers/settingsCoverageBuilders';
import { sessionExternalCalendarDegradeSignal } from '../../src/bases/externalCalendarDegradeNotice';
import { FIELD_MAPPING_KEYS } from '../../src/bases/fieldMappingConfig';
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

function viewConfig(hasProgressProperty: boolean): BasesViewConfig {
  return {
    get: (key: string) =>
      hasProgressProperty && key === FIELD_MAPPING_KEYS.progress ? 'note.progress' : undefined,
  } as unknown as BasesViewConfig;
}

/** The session degrade flag is sticky, so every clear cell must run before the first degraded one. */
function clearCellsFirst(cells: SettingsMatrixCell[]): SettingsMatrixCell[] {
  return [...cells.filter((cell) => !cell.degraded), ...cells.filter((cell) => cell.degraded)];
}

function cellName(cell: SettingsMatrixCell): string {
  return `companion=${cell.companionAvailable} progress=${cell.hasProgressProperty} degraded=${cell.degraded}`;
}

describe('settings-coverage parity with the registered options callback', () => {
  const feeds = oneFeedPerProvider(EXTERNAL_PROVIDER_ORDER);

  it('covers every combination of companion, progress property and degraded session', () => {
    expect(settingsArgumentMatrix()).toHaveLength(8);
  });

  it('serves one feed per registered provider', () => {
    const served = [
      ...feeds.subscriptions.map(() => 'ics'),
      ...feeds.calendars.map((calendar) => calendar.provider),
    ];

    expect([...served].sort()).toEqual([...EXTERNAL_PROVIDER_ORDER].sort());
  });

  it('the registered callback emits exactly the composed controls in every matrix cell', () => {
    for (const cell of clearCellsFirst(settingsArgumentMatrix())) {
      if (!cell.degraded) {
        expect(sessionExternalCalendarDegradeSignal.wasDegradedThisSession()).toBe(false);
      }
      const handle = cell.companionAvailable ? taskNotesHandleServing(feeds, cell.degraded) : null;
      const registered = captureOptionsCallback(handle)(viewConfig(cell.hasProgressProperty));
      const composed = composeRegisteredOptions(BUILDERS, { ...cell, feeds });

      expect({ cell: cellName(cell), triples: optionTriples(registered) }).toEqual({
        cell: cellName(cell),
        triples: optionTriples(composed),
      });
    }
  });

  it('a composed cell with feeds carries a toggle for every provider', () => {
    const composed = composeRegisteredOptions(BUILDERS, {
      companionAvailable: true,
      hasProgressProperty: false,
      degraded: false,
      feeds,
    });
    const keys = optionTriples(composed).map((triple) => triple.key);

    for (const kind of EXTERNAL_PROVIDER_ORDER) {
      expect(keys.some((key) => key.startsWith(externalCalendarToggleKey(kind, '')))).toBe(true);
    }
  });
});

/** Source-shape pin: the labels GanttToolbar.svelte renders for its labelled control groups. */
function renderedToolbarLabels(source: string): string[] {
  return [...source.matchAll(/class="og-toolbar-label">([^<]+)</g)].map((match) => match[1].trim());
}

describe('toolbar-persisted controls', () => {
  const toolbar = readFileSync(resolve('src/bases/GanttToolbar.svelte'), 'utf8');

  it('match the labels the toolbar renders', () => {
    const rendered = renderedToolbarLabels(toolbar);

    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toEqual(TOOLBAR_PERSISTED_CONTROLS.map((control) => control.uiLabel));
  });

  it('the pin sees a labelled control added to the toolbar', () => {
    const anchor = '<span class="og-toolbar-label">Theme</span>';
    expect(toolbar).toContain(anchor);
    const planted = toolbar.replace(anchor, `${anchor}<span class="og-toolbar-label">Density</span>`);

    expect(renderedToolbarLabels(planted)).toEqual(['Theme', 'Density']);
  });

  it('the pin finds nothing once the label markup it keys on changes', () => {
    expect(renderedToolbarLabels(toolbar.split('og-toolbar-label').join('og-toolbar-caption'))).toEqual([]);
  });
});
