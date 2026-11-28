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
  MAX_AUTO_TABLE_WIDTH,
  MIN_CHART_RESERVE_WIDTH,
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
  const COLUMNS = 520; // the rendered columns' combined resolved width

  it("returns a stored numeric width, rounded", () => {
    expect(resolveInitialGridWidth(300, COLUMNS)).toBe(300);
    expect(resolveInitialGridWidth(300.4, COLUMNS)).toBe(300);
  });

  it("coerces a numeric string (the text-control write path)", () => {
    expect(resolveInitialGridWidth("360", COLUMNS)).toBe(360);
  });

  it("clamps a value below the plugin minimum up to MIN_TABLE_WIDTH", () => {
    expect(resolveInitialGridWidth(10, COLUMNS)).toBe(MIN_TABLE_WIDTH);
    expect(resolveInitialGridWidth("10", COLUMNS)).toBe(MIN_TABLE_WIDTH);
  });

  it("falls back to the columns' combined width when unset, blank, non-numeric, or non-positive", () => {
    expect(resolveInitialGridWidth(undefined, COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth(null, COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth("", COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth("abc", COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth("300px", COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth(0, COLUMNS)).toBe(COLUMNS);
    expect(resolveInitialGridWidth(-5, COLUMNS)).toBe(COLUMNS);
  });

  it("passes the columns' width through even when it is itself below the minimum", () => {
    // The fallback is the columns' real combined width; it is not clamped to
    // the divider minimum (an unset view mirrors the columns, whatever their size).
    expect(resolveInitialGridWidth(undefined, 30)).toBe(30);
  });

  it('bounds the unset fallback to MAX_AUTO_TABLE_WIDTH, never a persisted width', () => {
    // A column set wider than a user could ever drag gets the pane + inner
    // scroll — not a pane that pushes the timeline off-screen.
    expect(resolveInitialGridWidth(undefined, 2000)).toBe(MAX_AUTO_TABLE_WIDTH);
    expect(resolveInitialGridWidth(null, 2000)).toBe(MAX_AUTO_TABLE_WIDTH);
    // A chosen width above the ceiling is honoured as stored.
    expect(resolveInitialGridWidth(1200, 2000)).toBe(1200);
  });

  it("bounds the unset fallback to the host minus the chart reserve, never a persisted width", () => {
    // A columns sum wider than the host leaves no timeline — and a divider the
    // user can never drag back. A 700px host caps the fallback at 500.
    expect(resolveInitialGridWidth(undefined, 2000, 700)).toBe(700 - MIN_CHART_RESERVE_WIDTH);
    // Columns narrower than the host bound still fit exactly.
    expect(resolveInitialGridWidth(undefined, COLUMNS, 1200)).toBe(COLUMNS);
    // Columns wider than the host bound shrink to it — pane scrolls instead of
    // hiding the timeline.
    expect(resolveInitialGridWidth(undefined, COLUMNS, 700)).toBe(500);
    // An unlaid-out host (0) keeps the drag-max bound alone.
    expect(resolveInitialGridWidth(undefined, 2000, 0)).toBe(MAX_AUTO_TABLE_WIDTH);
    // A host narrower than the reserve still leaves the draggable floor.
    expect(resolveInitialGridWidth(undefined, 2000, 150)).toBe(MIN_TABLE_WIDTH);
    // A chosen width is honoured as stored regardless of host.
    expect(resolveInitialGridWidth(800, 2000, 700)).toBe(800);
  });
});
