/**
 * Calibrated perf-harness param presets (#161 perf plan). Single source of truth
 * for the production-shaped structural mix + the instance-count scale points the
 * isolated gate (U4), full-stack spec (U5), and diagnosis CLI (U7) all use — so
 * the calibration (seed 1 → 31 / 980 / 3332 render instances under Show-all)
 * never drifts between consumers.
 *
 * @module test/perf/generator/presets
 */
import type { GenerateParams } from './graph';

/**
 * The shared structural mix (seed + relationship shape), independent of scale.
 * The scale fields (`totalNotes`/`taskCount`/`matchedCount`) are filled per
 * {@link ScalePoint}.
 */
export function structuralMix(): Omit<
  GenerateParams,
  'totalNotes' | 'taskCount' | 'matchedCount'
> {
  return {
    seed: 1,
    multiParentDist: [
      { parents: 2, count: 150 },
      { parents: 4, count: 40 },
      { parents: 7, count: 12 },
    ],
    maxDepth: 6,
    depDensity: 0.1,
    dateMix: { dated: 0.7, undated: 0.1, startOnly: 0.1, endOnly: 0.1 },
    cycleCount: 3,
    orphanCount: 6,
  };
}

/** Scale-only overrides per calibrated point (render-instance counts under Show-all). */
export interface ScaleConfig {
  totalNotes: number;
  taskCount: number;
  matchedCount: number;
  /** Optional heavier fan-out for the full production shape. */
  multiParentDist?: GenerateParams['multiParentDist'];
}

/** Calibrated scale points (seed 1; counts are the resulting render-instance totals). */
export const SCALE_POINTS = {
  /** ~31 instances — smoke / window-constant lower point. */
  small: { totalNotes: 3000, taskCount: 1500, matchedCount: 12 },
  /** ~980 instances — mid point. */
  medium: { totalNotes: 6000, taskCount: 3000, matchedCount: 30 },
  /** ~3332 instances — the #161 Show-all explosion scale (the primary gate point). */
  large: { totalNotes: 6000, taskCount: 3000, matchedCount: 70 },
  /** The full ~10k/~5k/~261 production shape (heavy diagnosis / scheduled parity). */
  full: {
    totalNotes: 10000,
    taskCount: 5000,
    matchedCount: 261,
    multiParentDist: [
      { parents: 2, count: 400 },
      { parents: 4, count: 120 },
      { parents: 7, count: 40 },
    ],
  },
} satisfies Record<string, ScaleConfig>;

export type ScalePointName = keyof typeof SCALE_POINTS;

/** Build full {@link GenerateParams} for a calibrated scale point, with optional overrides. */
export function paramsForScale(
  point: ScalePointName,
  overrides: Partial<GenerateParams> = {},
): GenerateParams {
  return { ...structuralMix(), ...SCALE_POINTS[point], ...overrides };
}
