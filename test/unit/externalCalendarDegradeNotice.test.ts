/**
 * Session degrade signal for the external-calendar family: a degraded collect
 * fires ONE dismissible Notice per Obsidian session, and the options panel
 * appends its gray-text degrade description only after the session flag
 * flips. The options-panel gate is driven through the REAL registration seam
 * (captured `options` builder), mirroring the blocking-builders harness.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { BasesAllOptions, BasesViewConfig, Plugin } from 'obsidian';
import {
  createExternalCalendarDegradeSignal,
  sessionExternalCalendarDegradeSignal,
  EXTERNAL_CALENDAR_DEGRADED_NOTICE,
} from '../../src/bases/externalCalendarDegradeNotice';
import { registerBasesGantt } from '../../src/bases/register';
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

describe('register options panel degrade gate (real registration seam)', () => {
  it('appends the degrade description line only after a degraded collect this session', () => {
    const options = captureOptionsBuilder();
    const config = { get: () => undefined } as unknown as BasesViewConfig;

    expect(hasDegradedEntry(options(config))).toBe(false);

    // The degraded collect path: the view's batch-flags hook feeds this
    // session-wide signal.
    sessionExternalCalendarDegradeSignal.observeCollect({ degraded: true });

    expect(hasDegradedEntry(options(config))).toBe(true);
  });
});
