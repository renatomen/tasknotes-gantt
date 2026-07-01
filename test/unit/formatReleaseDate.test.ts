import { formatReleaseDate } from "../../src/release/formatReleaseDate";

describe("formatReleaseDate", () => {
  it("formats an ISO date as 'Month D, YYYY'", () => {
    expect(formatReleaseDate("2026-07-01")).toBe("July 1, 2026");
    expect(formatReleaseDate("2026-06-23")).toBe("June 23, 2026");
  });

  it("does not shift the day across timezones (parses the string, not a Date)", () => {
    expect(formatReleaseDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatReleaseDate("2026-12-31")).toBe("December 31, 2026");
  });

  it("does not zero-pad the day", () => {
    expect(formatReleaseDate("2026-03-05")).toBe("March 5, 2026");
  });

  it("returns an empty string for null or empty input", () => {
    expect(formatReleaseDate(null)).toBe("");
    expect(formatReleaseDate("")).toBe("");
  });

  it("returns an empty string for a malformed date", () => {
    expect(formatReleaseDate("not-a-date")).toBe("");
    expect(formatReleaseDate("2026-13-01")).toBe("");
    expect(formatReleaseDate("2026-00-10")).toBe("");
    expect(formatReleaseDate("2026-02-30")).toBe("");
  });
});
