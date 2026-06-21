/**
 * Locks down the no-op guard that breaks the theme-toggle refresh loop:
 * persisting an unchanged grid width re-triggers Obsidian's onDataUpdated, which
 * refreshes the chart, which re-asserts the width — a self-feeding loop. The
 * guard returns null (skip) when the rounded width equals the stored value.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { nextPersistableWidth, persistGridWidth } from "../../src/bases/gridWidthPersist";

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
  it("writes the rounded width under tngantt_tableWidth when it changed", () => {
    const set = jest.fn();
    persistGridWidth(set, 300, 360);
    expect(set).toHaveBeenCalledWith("tngantt_tableWidth", 360);
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
