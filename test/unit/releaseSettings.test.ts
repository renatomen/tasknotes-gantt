import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  planWhatsNew,
} from "../../src/release/settings";

describe("normalizeSettings", () => {
  it("returns defaults for empty / non-object data", () => {
    expect(normalizeSettings(undefined)).toEqual({ showReleaseNotesOnUpdate: true });
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a valid toggle and last-seen version", () => {
    expect(normalizeSettings({ showReleaseNotesOnUpdate: false, lastSeenVersion: "1.2.0" })).toEqual({
      showReleaseNotesOnUpdate: false,
      lastSeenVersion: "1.2.0",
    });
  });

  it("drops a corrupt or over-long last-seen version", () => {
    expect(normalizeSettings({ lastSeenVersion: "garbage" })).toEqual({ showReleaseNotesOnUpdate: true });
    expect(normalizeSettings({ lastSeenVersion: "1.".repeat(40) })).toEqual({ showReleaseNotesOnUpdate: true });
    expect(normalizeSettings({ lastSeenVersion: 123 })).toEqual({ showReleaseNotesOnUpdate: true });
  });
});

describe("planWhatsNew", () => {
  it("fresh install (unset) records the version and shows nothing", () => {
    expect(planWhatsNew({ lastSeen: undefined, current: "1.2.0", showReleaseNotesOnUpdate: true })).toEqual({
      showView: false,
      recordVersion: true,
    });
  });

  it("corrupt last-seen heals to current, shows nothing", () => {
    expect(planWhatsNew({ lastSeen: "garbage", current: "1.2.0", showReleaseNotesOnUpdate: true })).toEqual({
      showView: false,
      recordVersion: true,
    });
  });

  it("update + toggle on → shows and records", () => {
    expect(planWhatsNew({ lastSeen: "1.1.0", current: "1.2.0", showReleaseNotesOnUpdate: true })).toEqual({
      showView: true,
      recordVersion: true,
    });
  });

  it("update + toggle off → records but does not show", () => {
    expect(planWhatsNew({ lastSeen: "1.1.0", current: "1.2.0", showReleaseNotesOnUpdate: false })).toEqual({
      showView: false,
      recordVersion: true,
    });
  });

  it("same version or downgrade → no view, no write", () => {
    expect(planWhatsNew({ lastSeen: "1.2.0", current: "1.2.0", showReleaseNotesOnUpdate: true })).toEqual({
      showView: false,
      recordVersion: false,
    });
    expect(planWhatsNew({ lastSeen: "1.3.0", current: "1.2.0", showReleaseNotesOnUpdate: true })).toEqual({
      showView: false,
      recordVersion: false,
    });
  });
});
