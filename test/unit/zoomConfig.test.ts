import { describe, expect, it } from "@jest/globals";
import {
  buildZoomConfig,
  initialCellWidth,
  normalizeDefaultScale,
} from "../../src/bases/zoomConfig";

describe("normalizeDefaultScale", () => {
  it.each(["hour", "day", "week", "month"] as const)("accepts %s", (scale) => {
    expect(normalizeDefaultScale(scale)).toBe(scale);
  });

  it.each([undefined, null, "", "quarter", 3])(
    "falls back to day for %p",
    (value) => {
      expect(normalizeDefaultScale(value)).toBe("day");
    }
  );
});

describe("buildZoomConfig", () => {
  it.each([
    ["month", 2, "month"],
    ["week", 3, "week"],
    ["day", 4, "day"],
    ["hour", 6, "hour"],
  ] as const)(
    "maps %s to level %i with a finest %s scale",
    (scale, level, unit) => {
      const config = buildZoomConfig(scale);

      expect(config.level).toBe(level);
      expect(config.levels[level]?.scales.at(-1)?.unit).toBe(unit);
    }
  );

  it("maps invalid values to the day level", () => {
    const config = buildZoomConfig("quarter");

    expect(config.level).toBe(4);
    expect(config.levels[config.level]?.scales.at(-1)?.unit).toBe("day");
  });

  it("returns a valid level for every supported view setting", () => {
    for (const scale of ["hour", "day", "week", "month"] as const) {
      const config = buildZoomConfig(scale);
      expect(config.levels[config.level]).toBeDefined();
    }
  });
});

describe("initialCellWidth", () => {
  it("opens the day scale at the day level's minimum width (narrowest day)", () => {
    const config = buildZoomConfig("day");
    const dayLevelMin = config.levels[config.level]?.minCellWidth;

    expect(initialCellWidth("day")).toBe(dayLevelMin);
    expect(initialCellWidth("day")).toBe(30);
  });

  it("defaults (invalid/blank) resolve to day and open narrow", () => {
    for (const value of [undefined, null, "", "quarter"]) {
      expect(initialCellWidth(value)).toBe(30);
    }
  });

  it("leaves every other scale at SVAR's default opening width", () => {
    for (const scale of ["hour", "week", "month"] as const) {
      expect(initialCellWidth(scale)).toBeUndefined();
    }
  });

  it("is a fixed constant — identical regardless of call site (deterministic)", () => {
    expect(initialCellWidth("day")).toBe(initialCellWidth("day"));
  });
});
