import { ganttViewOptions } from '../../src/bases/viewOptions';
import {
  calendarItemOptionsGroup,
  EXTERNAL_PROVIDER_ORDER,
  externalCalendarDegradedEntry,
  externalCalendarOptionEntries,
  externalCalendarToggleKey,
} from '../../src/bases/calendarItemOptions';
import { TOOLBAR_PERSISTED_CONTROLS } from '../../src/bases/themeResolver';

/** The real builders, as the settings-coverage script loads them from source. */
export const SETTINGS_BUILDERS = {
  ganttViewOptions,
  calendarItemOptionsGroup,
  externalCalendarOptionEntries,
  externalCalendarDegradedEntry,
  externalCalendarToggleKey,
  EXTERNAL_PROVIDER_ORDER,
  TOOLBAR_PERSISTED_CONTROLS,
};
