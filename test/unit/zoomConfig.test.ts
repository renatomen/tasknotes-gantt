import { describe, expect, it } from "@jest/globals";
import {
  buildZoomConfig,
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
