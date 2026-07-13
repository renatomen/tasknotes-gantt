export type DefaultScale = "hour" | "day" | "week" | "month";

interface ZoomScale {
  unit: string;
  step: number;
  format: string;
}

interface ZoomLevel {
  minCellWidth: number;
  maxCellWidth: number;
  scales: ZoomScale[];
}

export interface GanttZoomConfig {
  level: number;
  minCellWidth: number;
  maxCellWidth: number;
  levels: ZoomLevel[];
}

const DEFAULT_SCALE_LEVEL: Record<DefaultScale, number> = {
  month: 2,
  week: 3,
  day: 4,
  hour: 6,
};

// The narrowest day columns SVAR draws before it steps to the week view — the
// day level's minimum cell width. Shared by the ladder (below) and the day
// scale's opening width (initialCellWidth) so the two never drift.
const NARROWEST_DAY_CELL_WIDTH = 30;

// The seed-once SVAR zoom ladder, coarse (year) → fine (day/hour). Each level's
// [minCellWidth, maxCellWidth] bounds its cell width; SVAR steps to the adjacent
// level when the width crosses a bound.
// Scale formats use SVAR's locale (strftime-style %tokens), NOT date-fns.
// Token map: %Y year, %Q quarter, %F full month, %M short month,
// %W week-of-year, %j day-of-month, %D short weekday, %H:%i time.
const ZOOM_LEVELS: ZoomLevel[] = [
  {
    minCellWidth: 100,
    maxCellWidth: 300,
    scales: [{ unit: "year", step: 1, format: "%Y" }],
  },
  {
    minCellWidth: 80,
    maxCellWidth: 200,
    scales: [
      { unit: "year", step: 1, format: "%Y" },
      { unit: "quarter", step: 1, format: "Q%Q" },
    ],
  },
  {
    minCellWidth: 60,
    maxCellWidth: 150,
    scales: [
      { unit: "quarter", step: 1, format: "Q%Q %Y" },
      { unit: "month", step: 1, format: "%M" },
    ],
  },
  {
    minCellWidth: 50,
    maxCellWidth: 120,
    scales: [
      { unit: "month", step: 1, format: "%F %Y" },
      { unit: "week", step: 1, format: "W%W" },
    ],
  },
  {
    minCellWidth: NARROWEST_DAY_CELL_WIDTH,
    maxCellWidth: 80,
    scales: [
      { unit: "month", step: 1, format: "%F %Y" },
      { unit: "day", step: 1, format: "%j" },
    ],
  },
  {
    minCellWidth: 25,
    maxCellWidth: 60,
    scales: [
      { unit: "week", step: 1, format: "Week %W, %M %Y" },
      { unit: "day", step: 1, format: "%D %j" },
    ],
  },
  {
    minCellWidth: 40,
    maxCellWidth: 100,
    scales: [
      { unit: "day", step: 1, format: "%D %j %M" },
      { unit: "hour", step: 1, format: "%H:%i" },
    ],
  },
];

export function normalizeDefaultScale(value: unknown): DefaultScale {
  return value === "hour" || value === "week" || value === "month"
    ? value
    : "day";
}

/** Build the seed-once SVAR zoom ladder at the view's configured default scale. */
export function buildZoomConfig(defaultScale: unknown): GanttZoomConfig {
  const scale = normalizeDefaultScale(defaultScale);

  return {
    level: DEFAULT_SCALE_LEVEL[scale],
    minCellWidth: 40,
    maxCellWidth: 300,
    levels: ZOOM_LEVELS,
  };
}

/**
 * The cell width (px) the chart should OPEN at for `defaultScale`.
 *
 * For the **day** scale, open at the day level's *minimum* cell width — the
 * narrowest day columns SVAR draws before it steps to the week view — so a
 * day-scale chart doesn't start over-wide (users otherwise zoom out by hand
 * every session). Every other scale returns `undefined`, keeping SVAR's own
 * default opening width.
 *
 * Deterministic by construction: the value is a fixed constant taken from the
 * ladder, in CSS pixels, so every machine opens day at the identical width
 * regardless of screen size or DPI — SVAR scrolls the timeline horizontally, it
 * never stretches cells to fill the container.
 */
export function initialCellWidth(defaultScale: unknown): number | undefined {
  if (normalizeDefaultScale(defaultScale) !== "day") return undefined;
  return NARROWEST_DAY_CELL_WIDTH;
}
