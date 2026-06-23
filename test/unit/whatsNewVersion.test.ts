import { parseSemver, compareSemver, shouldShowWhatsNew } from "../../src/release/whatsNewVersion";

describe("parseSemver", () => {
  it("parses stable and prerelease, rejects garbage", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseSemver("1.2.0-beta.1")).toMatchObject({ prerelease: "beta.1" });
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders by major/minor/patch", () => {
    expect(compareSemver("1.1.0", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.2.0")).toBe(0);
  });
  it("orders a prerelease below its stable release", () => {
    expect(compareSemver("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0);
  });
  it("orders prerelease numbers numerically and returns 0 for unparseable input", () => {
    expect(compareSemver("1.2.0-beta.2", "1.2.0-beta.10")).toBeLessThan(0);
    expect(compareSemver("garbage", "1.2.0")).toBe(0);
  });
  it("orders alphanumeric prerelease identifiers lexically", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareSemver("1.0.0-rc", "1.0.0-beta")).toBeGreaterThan(0);
  });
  it("orders numeric below alphanumeric at the same identifier position", () => {
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
  });
  it("treats a longer prerelease as higher when the prefix is equal", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0-beta")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
  });
  it("returns 0 for identical prerelease versions", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0-beta.1")).toBe(0);
  });
});

describe("shouldShowWhatsNew", () => {
  it("shows when last-seen is strictly older than current", () => {
    expect(shouldShowWhatsNew("1.1.0", "1.2.0")).toBe(true);
    expect(shouldShowWhatsNew("1.2.0-beta.1", "1.2.0")).toBe(true);
  });
  it("does not show on equal version or downgrade", () => {
    expect(shouldShowWhatsNew("1.2.0", "1.2.0")).toBe(false);
    expect(shouldShowWhatsNew("1.2.0", "1.1.0")).toBe(false);
  });
  it("does not show on fresh install (unset) or corrupted last-seen", () => {
    expect(shouldShowWhatsNew(undefined, "1.2.0")).toBe(false);
    expect(shouldShowWhatsNew("", "1.2.0")).toBe(false);
    expect(shouldShowWhatsNew("garbage", "1.2.0")).toBe(false);
  });
});
