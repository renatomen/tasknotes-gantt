/**
 * focusController — pure focus-navigation decision core.
 *
 * Computes the focus navigation plan from plain data: which collapsed ancestors
 * to open, which zoom level best fits the target bar, and where to center the
 * view. No DOM, no SVAR, no Obsidian imports.
 *
 * @module bases/focusController
 */

/**
 * Minimal structural slice of a render instance needed for focus navigation.
 * Decoupled from RenderInstance to keep this module pure.
 */
export interface FocusInstance {
  id: string;
  sourcePath: string;
  text: string;
  start: Date | null;
  end: Date | null;
  /** Parent INSTANCE id (not sourcePath); chains up to root whose parent is undefined. */
  parent?: string;
}

/**
 * One rung in the SVAR zoom ladder.
 * Defined locally — do NOT import from zoomConfig.ts.
 */
export interface ZoomLevel {
  minCellWidth: number;
  maxCellWidth: number;
  scales: { unit: string; step: number; format: string }[];
}

/**
 * The computed plan for navigating to a focused task bar.
 */
export interface FocusPlan {
  /** Ancestor ids to open (expand), root-first, so they can be opened top-down. */
  ancestorsToOpen: string[];
  /** The zoom-level index that best fits the bar, or null when dates are unavailable. */
  targetLevel: number | null;
  /** The date to center the timeline on, or null when no start date is available. */
  centerDate: Date | null;
  /** True when a best-fit zoom was computed (start AND end with end > start). */
  fit: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UNIT_DAYS: Record<string, number> = {
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30,
  quarter: 91,
  year: 365,
};

/**
 * Days-per-cell for a given scale unit string.
 * Unknown units fall back to `day` (1).
 */
function daysPerCell(unit: string): number {
  return UNIT_DAYS[unit] ?? 1;
}

/**
 * The finest (densest = fewest days-per-cell) scale unit in a zoom level.
 * When a level has multiple scales, the finest drives the px/day estimate.
 */
function finestUnit(level: ZoomLevel): string {
  let best: string = 'day';
  let bestDays = Infinity;
  for (const scale of level.scales) {
    const days = daysPerCell(scale.unit);
    if (days < bestDays) {
      bestDays = days;
      best = scale.unit;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Walk the parent-instance-id chain from the target up to the root and collect
 * the ids of ancestors that are currently collapsed. Returns them root-first
 * (outermost first) so callers can open them top-down.
 *
 * Guards against cycles and missing parents — stops gracefully without throwing.
 *
 * @param instances - all visible render instances
 * @param targetId - the instance id to navigate to
 * @param isCollapsed - predicate that returns true when an ancestor is collapsed
 */
export function resolveAncestorsToOpen(
  instances: FocusInstance[],
  targetId: string,
  isCollapsed: (id: string) => boolean,
): string[] {
  const byId = new Map<string, FocusInstance>();
  for (const inst of instances) byId.set(inst.id, inst);

  const target = byId.get(targetId);
  if (!target || target.parent === undefined) return [];

  // Walk up the chain, collecting collapsed ancestor ids.
  const collapsed: string[] = [];
  const visited = new Set<string>(); // cycle guard
  let currentParentId: string | undefined = target.parent;

  while (currentParentId !== undefined) {
    if (visited.has(currentParentId)) break; // cycle — stop
    visited.add(currentParentId);

    const ancestor = byId.get(currentParentId);
    if (!ancestor) break; // missing parent — stop gracefully

    if (isCollapsed(currentParentId)) {
      collapsed.push(currentParentId);
    }

    currentParentId = ancestor.parent;
  }

  // `collapsed` is leaf-to-root; reverse for root-first order.
  collapsed.reverse();
  return collapsed;
}

/**
 * Estimate pixels per day for a zoom level.
 *
 * Uses a representative cell width (average of min and max) and the finest
 * (densest) scale unit to derive px/day. Coarser levels → fewer px/day.
 *
 * @param level - the zoom level to evaluate
 */
export function estimatePixelsPerDay(level: ZoomLevel): number {
  const repCellWidth = (level.minCellWidth + level.maxCellWidth) / 2;
  const unit = finestUnit(level);
  return repCellWidth / daysPerCell(unit);
}

/**
 * Select the most zoomed-in level whose bar still fits within 50 % of the
 * chart width.
 *
 * The ladder is NOT monotonic in px/day by index (a week-based level can be
 * sparser than the day-based level above it, and the hour level is far denser
 * than all others), so "most zoomed-in" means the LARGEST px/day — not the
 * largest index. Among levels whose bar fits within half the chart, returns the
 * **densest** (biggest bar that still fits). When none fit, returns the sparsest
 * level (smallest bar, least overflow). Selecting by density also makes a
 * separate visibility floor unnecessary: the densest fitting level already
 * maximizes the bar's on-screen size.
 *
 * @param opts.durationDays - duration of the target task in days
 * @param opts.chartWidthPx - full pixel width of the chart viewport
 * @param opts.levels - the zoom ladder (index 0 = coarsest)
 * @param opts.pixelsPerDay - optional px/day calculator; defaults to estimatePixelsPerDay
 */
export function selectZoomLevel(opts: {
  durationDays: number;
  chartWidthPx: number;
  levels: ZoomLevel[];
  pixelsPerDay?: (l: ZoomLevel) => number;
}): number {
  const ppd = opts.pixelsPerDay ?? estimatePixelsPerDay;
  const halfWidth = opts.chartWidthPx * 0.5;

  let bestIndex = -1;
  let bestPpd = -Infinity;
  let sparsestIndex = 0;
  let sparsestPpd = Infinity;
  for (let i = 0; i < opts.levels.length; i++) {
    const level = opts.levels[i];
    if (level === undefined) continue;
    const p = ppd(level);
    if (p < sparsestPpd) {
      sparsestPpd = p;
      sparsestIndex = i;
    }
    if (opts.durationDays * p <= halfWidth && p > bestPpd) {
      bestPpd = p;
      bestIndex = i;
    }
  }
  return bestIndex !== -1 ? bestIndex : sparsestIndex;
}

/**
 * Build the full focus navigation plan for a target instance.
 *
 * Combines ancestor resolution, zoom selection, and center-date derivation
 * into a single, pure, testable plan object.
 *
 * @param opts.instances - all visible render instances
 * @param opts.targetId - the instance id to navigate to
 * @param opts.chartWidthPx - chart viewport width in pixels
 * @param opts.levels - the zoom ladder
 * @param opts.isCollapsed - predicate for ancestor expansion check
 * @param opts.pixelsPerDay - optional px/day calculator (injectable for testing)
 */
export function buildFocusPlan(opts: {
  instances: FocusInstance[];
  targetId: string;
  chartWidthPx: number;
  levels: ZoomLevel[];
  isCollapsed: (id: string) => boolean;
  pixelsPerDay?: (l: ZoomLevel) => number;
}): FocusPlan {
  const ancestorsToOpen = resolveAncestorsToOpen(opts.instances, opts.targetId, opts.isCollapsed);

  const byId = new Map<string, FocusInstance>();
  for (const inst of opts.instances) byId.set(inst.id, inst);

  const target = byId.get(opts.targetId);
  if (!target) {
    return { ancestorsToOpen: [], targetLevel: null, centerDate: null, fit: false };
  }

  const { start, end } = target;

  if (start !== null && end !== null && end.getTime() > start.getTime()) {
    const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
    const centerDate = new Date((start.getTime() + end.getTime()) / 2);
    const targetLevel = selectZoomLevel({
      durationDays,
      chartWidthPx: opts.chartWidthPx,
      levels: opts.levels,
      pixelsPerDay: opts.pixelsPerDay,
    });
    return { ancestorsToOpen, targetLevel, centerDate, fit: true };
  }

  if (start !== null) {
    // Milestone or bad end date — center on start, no zoom fit.
    return { ancestorsToOpen, targetLevel: null, centerDate: start, fit: false };
  }

  // No dates at all.
  return { ancestorsToOpen, targetLevel: null, centerDate: null, fit: false };
}

/**
 * Deduplicate a list of instances by `sourcePath`, keeping the first occurrence
 * per path and preserving original order. Handles multi-parent expansions where
 * the same source note appears more than once.
 *
 * @param instances - potentially duplicated instance list
 */
export function dedupeInstancesBySource(instances: FocusInstance[]): FocusInstance[] {
  const seen = new Set<string>();
  const result: FocusInstance[] = [];
  for (const inst of instances) {
    if (!seen.has(inst.sourcePath)) {
      seen.add(inst.sourcePath);
      result.push(inst);
    }
  }
  return result;
}

/**
 * Build a display string for fuzzy-matching a focus instance by name and path.
 *
 * @param instance - the instance to label
 */
export function focusItemText(instance: FocusInstance): string {
  return `${instance.text} ${instance.sourcePath}`;
}

/** Minimal structural element for active-entry resolution (avoids a DOM dependency). */
export interface ContainerEl {
  contains(other: unknown): boolean;
}

/**
 * Resolve the focus opener for the active leaf (pure).
 *
 * Given the registered `[container, entry]` pairs (insertion-ordered) and the
 * active leaf's container, returns the entry whose registered container is
 * inside `activeContainer` (the Gantt in the focused leaf). Falls back to the
 * most-recently-registered entry when the active leaf isn't a Gantt view, and
 * null when there are no entries.
 *
 * @param entries - registered container→opener pairs, insertion order preserved
 * @param activeContainer - the active leaf's container element, if any
 */
export function pickActiveFocusEntry<E>(
  entries: Iterable<[ContainerEl, E]>,
  activeContainer: ContainerEl | null | undefined,
): E | null {
  let last: E | null = null;
  let firstMatch: E | null = null;
  let matched = false;
  for (const [containerEl, entry] of entries) {
    last = entry;
    if (!matched && activeContainer && activeContainer.contains(containerEl)) {
      firstMatch = entry;
      matched = true;
    }
  }
  return matched ? firstMatch : last;
}
