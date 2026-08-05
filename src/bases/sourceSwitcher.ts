/**
 * Quick source switcher — instant per-source show/hide over calendar-item rows.
 *
 * Hiding is a DISPLAY concern only: the hidden-source set feeds the composed
 * row-visibility predicate (see `bases/rowVisibility`), so the derived
 * instance set never changes when a source is hidden. Recurring occupancy is
 * additionally removed while shaping SVAR tasks so a hidden ancestor retained
 * as tree context cannot leak its occurrence geometry. Both paths are
 * presentation-only updates, never controller re-derivation.
 *
 * The set lives in per-view-instance SESSION state: the host owns one state
 * object for the view instance's lifetime, so it survives refreshes of the
 * same view and dies with it. It is never written to the Bases config — the
 * factory takes no persistence dependency, so a settings write is impossible
 * by construction.
 *
 * Kept free of Obsidian/Svelte/SVAR so every decision here is unit-testable;
 * the modal and command wiring live in `bases/SourceSwitcherModal`.
 *
 * @module bases/sourceSwitcher
 */

import type { CalendarItemFamily } from '../datasource/calendarItems';
import type { CalendarItemToggles } from './calendarItemOptions';
import { pickActiveFocusEntry, type ContainerEl } from './focusController';

/**
 * The hidden-set key an occupancy-rendered recurring task row hides under.
 * Named so the row-mapping and the census share one spelling of the family.
 */
export const RECURRING_SOURCE_KEY: CalendarItemFamily = 'recurring-instance';

/** The per-row source identity the switcher predicate reads. */
export interface SwitcherRowSource {
  /** The row's calendar-item family when it is a read-only event row. */
  calendarItemFamily?: CalendarItemFamily;
  /** True for a task row rendered through recurring-instance occupancy. */
  hasRecurringOccupancy?: boolean;
}

/**
 * Whether the hidden-source set hides this row. An event row hides under its
 * own family; an occupancy-carrying recurring task row IS the recurring
 * source's rendering (it carries no `calendarItem`), so it hides under the
 * `recurring-instance` key. Keys matching no rendered source are inert.
 */
export function isRowHiddenBySwitcher(
  row: SwitcherRowSource,
  hiddenSources: ReadonlySet<string> | undefined,
): boolean {
  if (!hiddenSources || hiddenSources.size === 0) return false;
  if (row.calendarItemFamily !== undefined && hiddenSources.has(row.calendarItemFamily)) {
    return true;
  }
  return row.hasRecurringOccupancy === true && hiddenSources.has(RECURRING_SOURCE_KEY);
}

/** Per-view session state: which sources are hidden right now. */
export interface SourceSwitcherState {
  /** Snapshot of the hidden source keys — safe to capture across later toggles. */
  hiddenSources(): ReadonlySet<CalendarItemFamily>;
  isHidden(family: CalendarItemFamily): boolean;
  /** Flip one source between hidden and shown, notifying subscribers. */
  toggle(family: CalendarItemFamily): void;
  /** Change notifications (the display-filter re-apply hook); returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** One switcher state per view instance; a new instance starts with nothing hidden. */
export function createSourceSwitcherState(): SourceSwitcherState {
  const hidden = new Set<CalendarItemFamily>();
  const listeners = new Set<() => void>();
  return {
    hiddenSources: () => new Set(hidden),
    isHidden: (family) => hidden.has(family),
    toggle: (family) => {
      if (!hidden.delete(family)) hidden.add(family);
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One family's standing in the current view: toggle state + rendered-row count. */
export interface SwitcherSourceCensusEntry {
  family: CalendarItemFamily;
  /** The family is configured on or still contributes rows that must remain recoverable. */
  enabled: boolean;
  /** Rows the family currently contributes (event rows; occupancy-rendered task rows for recurring). */
  count: number;
}

/** A source the switcher offers: a family that is enabled AND non-empty. */
export interface ActiveSwitcherSource {
  family: CalendarItemFamily;
  /** Display label, mirroring the option group's vocabulary. */
  label: string;
}

const SWITCHER_SOURCE_LABELS: Record<CalendarItemFamily, string> = {
  'recurring-instance': 'Recurring tasks',
  'time-entry': 'Time entries',
  timeblock: 'Timeblocks',
  'property-event': 'Property-based events',
  'external-event': 'External events',
};

/** The switchable sources: enabled AND non-empty families, in census order. */
export function activeSwitcherSources(
  census: readonly SwitcherSourceCensusEntry[],
): ActiveSwitcherSource[] {
  return census
    .filter((entry) => entry.enabled && entry.count > 0)
    .map((entry) => ({ family: entry.family, label: SWITCHER_SOURCE_LABELS[entry.family] }));
}

/** The per-instance source identity slice the row census reads. */
export interface CountableInstance {
  /** The event row's calendar item (family-bearing), when it is one. */
  calendarItem?: { family: CalendarItemFamily };
  /** The task row's occupancy attachments, when any family occupies it. */
  occupancy?: ReadonlyArray<{ family: CalendarItemFamily }>;
}

/**
 * Rows each family currently contributes: an event row counts under its own
 * family; a task row rendered through recurring-instance occupancy counts
 * under the recurring key (it IS that source's rendering — the same identity
 * rule as {@link isRowHiddenBySwitcher}). Plain task rows count nowhere.
 */
export function switcherCountsFromInstances(
  instances: ReadonlyArray<CountableInstance>,
): Map<CalendarItemFamily, number> {
  const counts = new Map<CalendarItemFamily, number>();
  const bump = (family: CalendarItemFamily): void => {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  };
  for (const instance of instances) {
    if (instance.calendarItem !== undefined) {
      bump(instance.calendarItem.family);
      continue;
    }
    if (instance.occupancy?.some((entry) => entry.family === RECURRING_SOURCE_KEY)) {
      bump(RECURRING_SOURCE_KEY);
    }
  }
  return counts;
}

/**
 * Bridge the per-view enablement state and current rendered-row counts into
 * the census the active-source list derives from. Toggle-backed families stay
 * enabled while they still contribute rows, so a hidden source remains
 * available to re-show during derivation transitions and parity exceptions.
 * External calendars have no family toggle — their per-feed visibility alone
 * determines enablement. Families with no enablement input are omitted.
 */
export function switcherSourceCensus(
  toggles: CalendarItemToggles,
  countByFamily: ReadonlyMap<CalendarItemFamily, number>,
  hasVisibleExternalFeed: boolean,
): SwitcherSourceCensusEntry[] {
  const toggleByFamily: ReadonlyArray<[CalendarItemFamily, boolean]> = [
    [RECURRING_SOURCE_KEY, toggles.showRecurring],
    ['time-entry', toggles.showTimeEntries],
    ['timeblock', toggles.showTimeblocks],
    ['property-event', toggles.showPropertyBasedEvents],
    ['external-event', hasVisibleExternalFeed],
  ];
  return toggleByFamily.map(([family, configuredEnabled]) => {
    const count = countByFamily.get(family) ?? 0;
    const enabled =
      family === 'external-event' ? configuredEnabled : configuredEnabled || count > 0;
    return { family, enabled, count };
  });
}

/**
 * Live switcher openers, one per mounted Gantt view — the same registry shape
 * and active-leaf resolution as the focus and calendar-picker entries.
 */
const liveSwitcherEntries = new Map<ContainerEl, () => void>();

/** Publish a mounted view's switcher opener; returns the teardown. */
export function registerSourceSwitcherEntry(container: ContainerEl, open: () => void): () => void {
  liveSwitcherEntries.set(container, open);
  return () => {
    liveSwitcherEntries.delete(container);
  };
}

/** The switcher opener for the active Gantt leaf, or null when none is mounted. */
export function getActiveGanttSourceSwitcherEntry(
  activeContainer?: ContainerEl | null,
): (() => void) | null {
  return pickActiveFocusEntry(liveSwitcherEntries, activeContainer);
}

/** The plugin surface the command registration needs (structural, so tests inject a fake). */
export interface SourceSwitcherCommandHost {
  app: { workspace: { activeLeaf: { view: { containerEl: ContainerEl } } | null } };
  addCommand(command: {
    id: string;
    name: string;
    checkCallback: (checking: boolean) => boolean;
  }): unknown;
}

/**
 * Register the "Quick source switcher" command: available only while a Gantt
 * view is mounted, opening the active view's switcher — the same activation
 * shape as the focus-task and select-calendars commands.
 */
export function registerSourceSwitcherCommand(host: SourceSwitcherCommandHost): void {
  host.addCommand({
    id: 'quick-source-switcher',
    name: 'Quick source switcher…',
    checkCallback: (checking: boolean): boolean => {
      const activeContainer = host.app.workspace.activeLeaf?.view.containerEl ?? null;
      const entry = getActiveGanttSourceSwitcherEntry(activeContainer);
      if (!entry) return false;
      if (!checking) entry();
      return true;
    },
  });
}
