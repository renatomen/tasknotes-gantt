/**
 * Session-scoped degrade signal for the external-calendar family: when a
 * collect observes an unreachable/reshaped service surface, the user gets one
 * dismissible Notice per Obsidian session, and the options panel appends a
 * gray-text description line (Bases toggle options carry no disabled/tooltip
 * shape, so a description is the panel's only degrade vocabulary). The Notice
 * constructor is injectable so the once-per-session contract is testable.
 *
 * @module bases/externalCalendarDegradeNotice
 */

import { Notice } from 'obsidian';

export const EXTERNAL_CALENDAR_DEGRADED_NOTICE =
  'TaskNotes Gantt: some external-calendar services are unavailable — their events are not shown.';

export interface ExternalCalendarDegradeSignal {
  /** Observe one external collect's flags; the first degraded one fires the Notice. */
  observeCollect(flags: { degraded: boolean }): void;
  /** Whether a collect degraded this session (the options panel's description gate). */
  wasDegradedThisSession(): boolean;
}

/** Build a degrade signal; state lives on the instance, so a fresh one is clean. */
export function createExternalCalendarDegradeSignal(
  showNotice: (message: string) => void = (message) => {
    // Duration 0 = dismissible, stays until closed.
    new Notice(message, 0);
  },
): ExternalCalendarDegradeSignal {
  let noticed = false;
  return {
    observeCollect(flags) {
      if (!flags.degraded || noticed) return;
      noticed = true;
      showNotice(EXTERNAL_CALENDAR_DEGRADED_NOTICE);
    },
    wasDegradedThisSession: () => noticed,
  };
}

/** The session-wide signal: one Notice per Obsidian session, across all mounts. */
export const sessionExternalCalendarDegradeSignal = createExternalCalendarDegradeSignal();
