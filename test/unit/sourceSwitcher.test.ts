/**
 * Quick source switcher: the per-row hidden-source predicate, the per-view
 * session state, the active-source census, and the command entry registry.
 * Composition runs through the shouldHideRow seam, so hiding stays a display
 * filter over the stable instance set — never a data-layer add/remove.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  activeSwitcherSources,
  createSourceSwitcherState,
  getActiveGanttSourceSwitcherEntry,
  isRowHiddenBySwitcher,
  registerSourceSwitcherCommand,
  registerSourceSwitcherEntry,
  switcherCountsFromInstances,
  switcherSourceCensus,
  RECURRING_SOURCE_KEY,
  type SourceSwitcherCommandHost,
  type SwitcherSourceCensusEntry,
} from '../../src/bases/sourceSwitcher';
import {
  anyRowFilterActive,
  shouldHideRow,
  type RowVisibilityFlags,
  type RowVisibilityInput,
} from '../../src/bases/rowVisibility';
import type { CalendarItemFamily } from '../../src/datasource/calendarItems';
import type { CalendarItemToggles } from '../../src/bases/calendarItemOptions';

/** Row-visibility flags with every option at its show-everything default. */
const SHOW_ALL = {
  hideTopLevel: false,
  showUndated: true,
  showPartial: true,
} as const;

function eventRow(family: CalendarItemFamily): RowVisibilityInput {
  return {
    isTopLevelPlacement: false,
    dateStatus: 'complete',
    source: { calendarItemFamily: family },
  };
}

function recurringRow(): RowVisibilityInput {
  return {
    isTopLevelPlacement: false,
    dateStatus: 'complete',
    source: { hasRecurringOccupancy: true },
  };
}

function taskRow(): RowVisibilityInput {
  return { isTopLevelPlacement: false, dateStatus: 'complete' };
}

describe('isRowHiddenBySwitcher', () => {
  it('hides an event row exactly when its family is in the hidden set', () => {
    const hidden = new Set(['time-entry']);
    expect(isRowHiddenBySwitcher({ calendarItemFamily: 'time-entry' }, hidden)).toBe(true);
    expect(isRowHiddenBySwitcher({ calendarItemFamily: 'timeblock' }, hidden)).toBe(false);
    // A plain task row carries no source identity and is never the switcher's target.
    expect(isRowHiddenBySwitcher({}, hidden)).toBe(false);
  });

  it('hides an occupancy-carrying recurring row under the recurring-instance key only', () => {
    expect(
      isRowHiddenBySwitcher({ hasRecurringOccupancy: true }, new Set([RECURRING_SOURCE_KEY])),
    ).toBe(true);
    expect(
      isRowHiddenBySwitcher({ hasRecurringOccupancy: true }, new Set(['time-entry'])),
    ).toBe(false);
  });

  it('an unknown key in the hidden set is inert', () => {
    const hidden = new Set(['no-such-family']);
    expect(isRowHiddenBySwitcher({ calendarItemFamily: 'time-entry' }, hidden)).toBe(false);
    expect(isRowHiddenBySwitcher({ hasRecurringOccupancy: true }, hidden)).toBe(false);
  });

  it('an empty or absent hidden set hides nothing', () => {
    expect(isRowHiddenBySwitcher({ calendarItemFamily: 'timeblock' }, new Set())).toBe(false);
    expect(isRowHiddenBySwitcher({ calendarItemFamily: 'timeblock' }, undefined)).toBe(false);
  });
});

describe('composition through shouldHideRow', () => {
  it('hiding a source hides its rows via the display predicate, leaving the fixture set untouched', () => {
    const rows = [eventRow('time-entry'), taskRow(), recurringRow()];
    const flags: RowVisibilityFlags = { ...SHOW_ALL, hiddenSources: new Set(['time-entry']) };
    const visible = rows.filter((row) => !shouldHideRow(row, flags));
    expect(visible).toEqual([taskRow(), recurringRow()]);
    // Display-only: the derived row set the predicate ran over is unchanged.
    expect(rows).toEqual([eventRow('time-entry'), taskRow(), recurringRow()]);
  });

  it('row-visibility options and the switcher compose: either hiding rule hides', () => {
    const flags: RowVisibilityFlags = {
      ...SHOW_ALL,
      hideTopLevel: true,
      hiddenSources: new Set(['time-entry']),
    };
    expect(shouldHideRow(eventRow('time-entry'), flags)).toBe(true);
    expect(shouldHideRow({ isTopLevelPlacement: true, dateStatus: 'complete' }, flags)).toBe(true);
    // Passing BOTH predicates is the only way to stay visible.
    expect(shouldHideRow(eventRow('timeblock'), flags)).toBe(false);
  });

  it('toggling external events hidden hides its rows via the display predicate', () => {
    const state = createSourceSwitcherState();
    state.toggle('external-event');
    const flags: RowVisibilityFlags = { ...SHOW_ALL, hiddenSources: state.hiddenSources() };
    expect(shouldHideRow(eventRow('external-event'), flags)).toBe(true);
    expect(shouldHideRow(eventRow('time-entry'), flags)).toBe(false);
    expect(shouldHideRow(taskRow(), flags)).toBe(false);
  });

  it('a non-empty hidden set alone keeps the composed filter active (clear-path gate)', () => {
    expect(anyRowFilterActive({ ...SHOW_ALL, hiddenSources: new Set(['time-entry']) })).toBe(true);
  });

  it('an empty hidden set leaves the default clear path', () => {
    expect(anyRowFilterActive({ ...SHOW_ALL, hiddenSources: new Set() })).toBe(false);
    expect(anyRowFilterActive({ ...SHOW_ALL })).toBe(false);
  });
});

describe('createSourceSwitcherState', () => {
  it('toggle flips a source between hidden and shown', () => {
    const state = createSourceSwitcherState();
    state.toggle('time-entry');
    expect(state.isHidden('time-entry')).toBe(true);
    expect(state.hiddenSources()).toEqual(new Set(['time-entry']));
    state.toggle('time-entry');
    expect(state.isHidden('time-entry')).toBe(false);
    expect(state.hiddenSources().size).toBe(0);
  });

  it('hiddenSources() is a snapshot: later toggles never mutate an earlier read', () => {
    const state = createSourceSwitcherState();
    state.toggle('timeblock');
    const captured = state.hiddenSources();
    state.toggle('timeblock');
    expect(captured.has('timeblock')).toBe(true);
    expect(state.hiddenSources().has('timeblock')).toBe(false);
  });

  it('notifies subscribers on each toggle until unsubscribed', () => {
    const state = createSourceSwitcherState();
    const listener = jest.fn();
    const unsubscribe = state.subscribe(listener);
    state.toggle('time-entry');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    state.toggle('time-entry');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the same state instance keeps hiding across a simulated same-instance refresh', () => {
    // A refresh re-reads the SAME per-view state object (the host holds it for
    // the view instance's lifetime), rebuilding the flags from scratch.
    const viewInstanceState = createSourceSwitcherState();
    viewInstanceState.toggle(RECURRING_SOURCE_KEY);
    const flagsAfterRefresh: RowVisibilityFlags = {
      ...SHOW_ALL,
      hiddenSources: viewInstanceState.hiddenSources(),
    };
    expect(shouldHideRow(recurringRow(), flagsAfterRefresh)).toBe(true);
  });

  it('a new view instance scope starts with nothing hidden', () => {
    const nextInstanceState = createSourceSwitcherState();
    expect(nextInstanceState.hiddenSources().size).toBe(0);
  });
});

describe('active sources', () => {
  const ALL_ON: CalendarItemToggles = {
    showRecurring: true,
    showCompletedRecurringInstances: true,
    showSkippedRecurringInstances: true,
    showTimeEntries: true,
    showTimeblocks: true,
    showPropertyBasedEvents: true,
    propertyEventStart: 'note.start',
    propertyEventEnd: '',
    propertyEventTitle: '',
  };

  it('the census follows the family toggles for enabled and the provided counts', () => {
    const toggles: CalendarItemToggles = { ...ALL_ON, showTimeblocks: false };
    const census = switcherSourceCensus(
      toggles,
      new Map<CalendarItemFamily, number>([
        ['recurring-instance', 3],
        ['timeblock', 5],
      ]),
      false,
    );
    expect(census).toEqual([
      { family: 'recurring-instance', enabled: true, count: 3 },
      { family: 'time-entry', enabled: true, count: 0 },
      { family: 'timeblock', enabled: false, count: 5 },
      { family: 'property-event', enabled: true, count: 0 },
      { family: 'external-event', enabled: false, count: 0 },
    ]);
  });

  it('offers external events when a visible feed exists and rows render', () => {
    const census = switcherSourceCensus(
      ALL_ON,
      new Map<CalendarItemFamily, number>([['external-event', 2]]),
      true,
    );
    expect(census).toContainEqual({ family: 'external-event', enabled: true, count: 2 });
    expect(activeSwitcherSources(census)).toContainEqual({
      family: 'external-event',
      label: 'External events',
    });
  });

  it('external stays inactive without a visible feed even when rows rendered', () => {
    const census = switcherSourceCensus(
      ALL_ON,
      new Map<CalendarItemFamily, number>([['external-event', 2]]),
      false,
    );
    expect(census).toContainEqual({ family: 'external-event', enabled: false, count: 2 });
    expect(activeSwitcherSources(census).map((source) => source.family)).not.toContain(
      'external-event',
    );
  });

  it('external with a visible feed but no rendered rows is not active', () => {
    const census = switcherSourceCensus(ALL_ON, new Map<CalendarItemFamily, number>(), true);
    expect(census).toContainEqual({ family: 'external-event', enabled: true, count: 0 });
    expect(activeSwitcherSources(census).map((source) => source.family)).not.toContain(
      'external-event',
    );
  });

  it('active sources are exactly the enabled AND non-empty families, labelled for display', () => {
    const census: SwitcherSourceCensusEntry[] = [
      { family: 'recurring-instance', enabled: true, count: 3 },
      { family: 'time-entry', enabled: true, count: 0 },
      { family: 'timeblock', enabled: false, count: 5 },
      { family: 'property-event', enabled: true, count: 2 },
    ];
    expect(activeSwitcherSources(census)).toEqual([
      { family: 'recurring-instance', label: 'Recurring tasks' },
      { family: 'property-event', label: 'Property-based events' },
    ]);
  });

  it('counts rendered rows per family: event rows by their family, recurring by occupancy', () => {
    const counts = switcherCountsFromInstances([
      { calendarItem: { family: 'time-entry' } },
      { calendarItem: { family: 'time-entry' } },
      { calendarItem: { family: 'timeblock' } },
      { occupancy: [{ family: 'recurring-instance' }] },
      // A plain task row contributes to no family.
      {},
      // Occupancy of a non-recurring family never counts under the recurring key.
      { occupancy: [{ family: 'time-entry' }] },
    ]);
    expect(counts.get('time-entry')).toBe(2);
    expect(counts.get('timeblock')).toBe(1);
    expect(counts.get('recurring-instance')).toBe(1);
    expect(counts.get('property-event')).toBeUndefined();
  });
});

describe('switcher command and entry registry', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of cleanups.splice(0)) dispose();
  });

  function detachedContainer(): { contains(other: unknown): boolean } {
    return { contains: () => false };
  }

  it('resolves the entry mounted inside the active container', () => {
    const mountEl = detachedContainer();
    const open = jest.fn();
    cleanups.push(registerSourceSwitcherEntry(mountEl, open));
    const activeContainer = { contains: (other: unknown) => other === mountEl };
    expect(getActiveGanttSourceSwitcherEntry(activeContainer)).toBe(open);
  });

  it('a disposed entry no longer resolves', () => {
    const mountEl = detachedContainer();
    const dispose = registerSourceSwitcherEntry(mountEl, jest.fn());
    dispose();
    expect(
      getActiveGanttSourceSwitcherEntry({ contains: (other: unknown) => other === mountEl }),
    ).toBeNull();
  });

  it('the command is unavailable without a mounted view and opens the active one', () => {
    const commands: Parameters<SourceSwitcherCommandHost['addCommand']>[0][] = [];
    const mountEl = detachedContainer();
    const host: SourceSwitcherCommandHost = {
      app: {
        workspace: {
          activeLeaf: { view: { containerEl: { contains: (other) => other === mountEl } } },
        },
      },
      addCommand: (command) => {
        commands.push(command);
      },
    };
    registerSourceSwitcherCommand(host);
    const command = commands[0]!;
    expect(command.id).toBe('quick-source-switcher');
    expect(command.checkCallback(true)).toBe(false);

    const open = jest.fn();
    cleanups.push(registerSourceSwitcherEntry(mountEl, open));
    expect(command.checkCallback(true)).toBe(true);
    expect(open).not.toHaveBeenCalled();
    command.checkCallback(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
