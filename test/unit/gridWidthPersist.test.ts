/**
 * Locks down the no-op guard that breaks the theme-toggle refresh loop:
 * persisting an unchanged grid width re-triggers Obsidian's onDataUpdated, which
 * refreshes the chart, which re-asserts the width — a self-feeding loop. The
 * guard returns null (skip) when the rounded width equals the stored value.
 */
import { describe, expect, it, jest } from "@jest/globals";
import {
  nextPersistableWidth,
  persistGridWidth,
  resolveInitialGridWidth,
  MIN_TABLE_WIDTH,
} from "../../src/bases/gridWidthPersist";

describe("nextPersistableWidth", () => {
  it("returns null (skip) when the rounded width is unchanged — breaks the loop", () => {
    expect(nextPersistableWidth(300, 300)).toBeNull();
    // SVAR may report a fractional width that rounds to the stored value.
    expect(nextPersistableWidth(300.4, 300)).toBeNull();
  });

  it("returns the rounded width when it changed (a real divider drag)", () => {
    expect(nextPersistableWidth(360, 300)).toBe(360);
    expect(nextPersistableWidth(287.6, 300)).toBe(288);
  });

  it("persists on first set when nothing is stored yet", () => {
    expect(nextPersistableWidth(300, undefined)).toBe(300);
  });
});

describe("persistGridWidth", () => {
  it("writes the rounded width as a STRING under tngantt_tableWidth when it changed", () => {
    const set = jest.fn();
    persistGridWidth(set, 300, 360);
    // String, not number: the key is a Bases `text` option; a number write is
    // dropped by Bases (clearing the setting on a divider drag). See persistGridWidth.
    expect(set).toHaveBeenCalledWith("tngantt_tableWidth", "360");
  });

  it("does NOT write when the width is unchanged (loop guard)", () => {
    const set = jest.fn();
    persistGridWidth(set, 300, 300);
    expect(set).not.toHaveBeenCalled();
  });

  it("swallows a failing write so it never propagates out of the resize handler", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const set = jest.fn(() => {
      throw new Error("config unavailable");
    });
    expect(() => persistGridWidth(set, 300, 360)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("resolveInitialGridWidth", () => {
  const FIRST_COL = 240; // the name column's resolved width (columnSize or default)

  it("returns a stored numeric width, rounded", () => {
    expect(resolveInitialGridWidth(300, FIRST_COL)).toBe(300);
    expect(resolveInitialGridWidth(300.4, FIRST_COL)).toBe(300);
  });

  it("coerces a numeric string (the text-control write path)", () => {
    expect(resolveInitialGridWidth("360", FIRST_COL)).toBe(360);
  });

  it("clamps a value below the plugin minimum up to MIN_TABLE_WIDTH", () => {
    expect(resolveInitialGridWidth(10, FIRST_COL)).toBe(MIN_TABLE_WIDTH);
    expect(resolveInitialGridWidth("10", FIRST_COL)).toBe(MIN_TABLE_WIDTH);
  });

  it("falls back to the first-column width when unset, blank, non-numeric, or non-positive", () => {
    expect(resolveInitialGridWidth(undefined, FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth(null, FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth("", FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth("abc", FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth("300px", FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth(0, FIRST_COL)).toBe(FIRST_COL);
    expect(resolveInitialGridWidth(-5, FIRST_COL)).toBe(FIRST_COL);
  });

  it("passes the first-column width through even when it is itself below the minimum", () => {
    // The fallback is the name column's real width; it is not clamped to the
    // divider minimum (an unset view mirrors the column, whatever its size).
    expect(resolveInitialGridWidth(undefined, 30)).toBe(30);
  });
});
