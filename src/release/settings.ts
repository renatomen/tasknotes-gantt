/**
 * Plugin settings shape + pure decision logic for the in-app "What's New" flow.
 * Kept Obsidian-free so it is fully unit-testable; src/main.ts does the IO
 * (loadData/saveData, manifest read, view activation).
 */
import { parseSemver, shouldShowWhatsNew } from "./whatsNewVersion";

export interface GanttPluginSettings {
  /** Auto-open the "What's New" view once after a plugin update. */
  showReleaseNotesOnUpdate: boolean;
  /** Highest version whose notes the user has already been shown. */
  lastSeenVersion?: string;
}

export const DEFAULT_SETTINGS: GanttPluginSettings = {
  showReleaseNotesOnUpdate: true,
};

const MAX_VERSION_LENGTH = 32;

/**
 * Merge persisted `data.json` over defaults, validating `lastSeenVersion`: a
 * corrupted or over-long value (hand-edited / unparseable) is dropped to
 * `undefined` rather than flowing into the version comparison (defence-in-depth
 * beyond the read-time guard in shouldShowWhatsNew).
 */
export function normalizeSettings(raw: unknown): GanttPluginSettings {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const showReleaseNotesOnUpdate =
    typeof data.showReleaseNotesOnUpdate === "boolean"
      ? data.showReleaseNotesOnUpdate
      : DEFAULT_SETTINGS.showReleaseNotesOnUpdate;
  const lv = data.lastSeenVersion;
  const lastSeenVersion =
    typeof lv === "string" && lv.length <= MAX_VERSION_LENGTH && parseSemver(lv) ? lv : undefined;
  return lastSeenVersion ? { showReleaseNotesOnUpdate, lastSeenVersion } : { showReleaseNotesOnUpdate };
}

export interface WhatsNewPlan {
  /** Whether to activate the "What's New" view now. */
  showView: boolean;
  /** Whether to persist the current version as the new last-seen. */
  recordVersion: boolean;
}

/**
 * Decide what to do on load, given the recorded last-seen version, the current
 * version, and the toggle. Pure.
 *
 *  - Fresh install / corrupt last-seen → record current, show nothing (never
 *    surprise a new user).
 *  - Last-seen strictly older than current → show iff the toggle is on; always
 *    record so it only shows once per version.
 *  - Same version or downgrade → do nothing (no view, no write).
 */
export function planWhatsNew(args: {
  lastSeen: string | undefined;
  current: string;
  showReleaseNotesOnUpdate: boolean;
}): WhatsNewPlan {
  const { lastSeen, current, showReleaseNotesOnUpdate } = args;
  if (!lastSeen || !parseSemver(lastSeen)) {
    return { showView: false, recordVersion: true };
  }
  if (shouldShowWhatsNew(lastSeen, current)) {
    return { showView: showReleaseNotesOnUpdate, recordVersion: true };
  }
  return { showView: false, recordVersion: false };
}
