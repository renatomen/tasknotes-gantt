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
    // Scale formats use SVAR's locale (strftime-style %tokens), NOT date-fns.
    // Token map: %Y year, %Q quarter, %F full month, %M short month,
    // %W week-of-year, %j day-of-month, %D short weekday, %H:%i time.
    levels: [
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
        minCellWidth: 30,
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
    ],
  };
}
