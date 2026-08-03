/**
 * Session degrade signal for the external-calendar family: a degraded collect
 * fires ONE dismissible Notice per Obsidian session, and the options panel
 * appends its gray-text degrade description only after the session flag
 * flips. The wiring test drives the REAL production path: a provider built
 * with the exact batch-flags observer the mount wires, whose degraded collect
 * must reach the session Notice and the captured `options` builder's gate.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { Notice } from 'obsidian';
import type { BasesAllOptions, BasesViewConfig, Plugin } from 'obsidian';
import {
  createExternalCalendarDegradeSignal,
  sessionExternalCalendarDegradeSignal,
  EXTERNAL_CALENDAR_DEGRADED_NOTICE,
} from '../../src/bases/externalCalendarDegradeNotice';
import { registerBasesGantt, wireExternalBatchFlags } from '../../src/bases/register';
import { createCalendarItemSourcesProvider } from '../../src/bases/calendarItemSources';
import { readCalendarItemToggles } from '../../src/bases/calendarItemOptions';
import { externalCalendarFeedKey } from '../../src/datasource/calendarItems/externalCalendarSource';
import type { CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import type { PluginLifetime } from '../../src/bases/createCalendarNote';

describe('createExternalCalendarDegradeSignal', () => {
  it('fires exactly one Notice for the first degraded collect and flips the session flag', () => {
    const showNotice = jest.fn();
    const signal = createExternalCalendarDegradeSignal(showNotice);
    expect(signal.wasDegradedThisSession()).toBe(false);

    signal.observeCollect({ degraded: true });

    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(showNotice).toHaveBeenCalledWith(EXTERNAL_CALENDAR_DEGRADED_NOTICE);
    expect(signal.wasDegradedThisSession()).toBe(true);
  });

  it('a second degraded collect in the same session is silent', () => {
    const showNotice = jest.fn();
    const signal = createExternalCalendarDegradeSignal(showNotice);

    signal.observeCollect({ degraded: true });
    signal.observeCollect({ degraded: true });

    expect(showNotice).toHaveBeenCalledTimes(1);
  });

  it('healthy collects neither fire the Notice nor flip the flag', () => {
    const showNotice = jest.fn();
    const signal = createExternalCalendarDegradeSignal(showNotice);

    signal.observeCollect({ degraded: false });

    expect(showNotice).not.toHaveBeenCalled();
    expect(signal.wasDegradedThisSession()).toBe(false);
  });

  it('a fresh instance starts clean (session state lives on the instance)', () => {
    const first = createExternalCalendarDegradeSignal(jest.fn());
    first.observeCollect({ degraded: true });

    const second = createExternalCalendarDegradeSignal(jest.fn());

    expect(second.wasDegradedThisSession()).toBe(false);
  });
});

/** Capture the REAL registration's options builder over a TaskNotes-present app. */
function captureOptionsBuilder(): (config: BasesViewConfig) => BasesAllOptions[] {
  const taskNotesHandle = {
    api: {},
    icsSubscriptionService: { getSubscriptions: () => [], getAllEvents: () => [] },
    calendarProviderRegistry: { getAllProviders: () => [] },
  };
  const app = {
    plugins: { getPlugin: (id: string) => (id === 'tasknotes' ? taskNotesHandle : null) },
  };
  let captured: { options?: (config: BasesViewConfig) => BasesAllOptions[] } | null = null;
  const plugin = {
    app,
    registerBasesView: (
      _id: string,
      opts: { options?: (config: BasesViewConfig) => BasesAllOptions[] },
    ) => {
      captured = opts;
      return true;
    },
  } as unknown as Plugin;
  const calendarLifetime: PluginLifetime = {
    isActive: () => true,
    scope: () => ({
      own: (source, subscribe) => {
        subscribe(source);
      },
      defer: () => {},
      close: () => {},
    }),
  };
  registerBasesGantt(plugin, calendarLifetime);
  const options = (captured as { options?: (config: BasesViewConfig) => BasesAllOptions[] } | null)
    ?.options;
  if (!options) throw new Error('options builder was not captured');
  return options;
}

function hasDegradedEntry(groups: BasesAllOptions[]): boolean {
  const calendarItems = groups.find(
    (group) => (group as { displayName?: string }).displayName === 'Calendar items',
  ) as { items?: Array<{ key?: string }> } | undefined;
  return (calendarItems?.items ?? []).some(
    (item) => item.key === 'tngantt_externalCalendarDegraded',
  );
}

describe('register wiring: degraded collect → session Notice → options degrade line', () => {
  it('a degraded external collect through the wired batch-flags path fires the Notice and appends the options line', async () => {
    const options = captureOptionsBuilder();
    const config = { get: () => undefined } as unknown as BasesViewConfig;
    expect(hasDegradedEntry(options(config))).toBe(false);
    expect(Notice.created).toHaveLength(0);

    const loadingStates: boolean[] = [];
    // The provider assembled exactly as the mount does: the same observer
    // (register's wiring seam) between collect flags and the session signal.
    const provider = createCalendarItemSourcesProvider({
      toggles: () => readCalendarItemToggles(() => undefined),
      listTasks: () => [],
      // The TaskNotes handle is gone by collect time, so the guarded surface
      // reads degrade instead of throwing.
      getTaskNotesPlugin: () => undefined,
      visibleExternalFeeds: () => new Set([externalCalendarFeedKey('ics', 'work-cal')]),
      scheduler: {
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
      },
      onExternalBatchFlags: wireExternalBatchFlags((loading) => loadingStates.push(loading)),
    });
    const external = provider.provide().find((source) => source.family === 'external-event');
    if (!external) throw new Error('external-calendar source was not provided');

    const context: CalendarItemQueryContext = {
      window: { startDate: '2026-08-01', endDateExclusive: '2026-10-01' },
      tasks: () => [],
      basesEntries: () => [],
    };
    const batch = await external.collect(context);
    provider.dispose();

    expect(batch.degraded).toBe(true);
    expect(loadingStates).toEqual([false]);
    expect(Notice.created.map((notice) => notice.message)).toEqual([
      EXTERNAL_CALENDAR_DEGRADED_NOTICE,
    ]);
    expect(sessionExternalCalendarDegradeSignal.wasDegradedThisSession()).toBe(true);
    expect(hasDegradedEntry(options(config))).toBe(true);
  });
});
