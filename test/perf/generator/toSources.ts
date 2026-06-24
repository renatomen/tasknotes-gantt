/**
 * Graph → in-memory data sources (U3, #161 perf plan). Turns a canonical
 * {@link TaskGraph} into the two `DataSource`s the bases-scoped controller
 * consumes — a Base source (the matched task set) and a TaskNotes-style
 * enrichment that exposes dependencies plus the bulk relationship index
 * (`getRelationshipIndex`) the companion stage duck-types on. This is the
 * isolated-layer half of KD6's single-canonical-graph: it mirrors the
 * `CompanionEnrichment`/`FakeSource` fakes in `test/unit/GanttController.test.ts`
 * so the controller's real companion pipeline runs unchanged.
 *
 * No Obsidian: pure value objects, so it runs under jest's `node` env as well as
 * in the browser harness.
 *
 * @module test/perf/generator/toSources
 */
import type {
  DataSource,
  DataSourceCapabilities,
  SourceDependency,
  SourceTask,
  StatusColor,
} from '../../../src/datasource/types';
import type {
  CompanionAccessor,
  RelationshipIndex,
} from '../../../src/datasource/companionResolve';
import type { GraphTask, TaskGraph } from './graph';

/** The composable sources the perf controller is wired with. */
export interface PerfSources {
  /** The Base task set (the matched ~261), read-only. */
  baseSource: DataSource;
  /**
   * TaskNotes-style enrichment: dependency edges + the bulk relationship index
   * (so the companion Show-all stage activates), read-only.
   */
  enrichment: DataSource & CompanionAccessor;
}

const READ_ONLY: DataSourceCapabilities = { write: false };

/** Map a graph task to a raw `SourceTask` (native values, due → `end`). */
function toSourceTask(task: GraphTask): SourceTask {
  return {
    path: task.path,
    text: task.title,
    start: task.start,
    end: task.due,
    progress: null,
    status: task.status,
    parents: task.parents,
  };
}

/** A small status palette so the color path is exercised (statuses → hues). */
function statusColors(graph: TaskGraph): StatusColor[] {
  const palette: Record<string, { color: string; isCompleted: boolean }> = {
    open: { color: '#9aa0a6', isCompleted: false },
    'in-progress': { color: '#1a73e8', isCompleted: false },
    blocked: { color: '#f8312f', isCompleted: false },
    done: { color: '#34a853', isCompleted: true },
  };
  const present = new Set(graph.tasks.map((t) => t.status));
  return [...present]
    .filter((s) => palette[s])
    .map((s) => ({ value: s, color: (palette[s] as { color: string }).color, isCompleted: (palette[s] as { isCompleted: boolean }).isCompleted }));
}

/**
 * Build the bulk relationship index from the full graph in one pass:
 * `parentsByPath` from each task's `projects` edges (orphan refs included — they
 * stay dangling), `childrenByPath` from the inverse (full `SourceTask`s, since
 * Show-all reads fetched descendants' data straight out of this map).
 */
function buildRelationshipIndex(graph: TaskGraph): RelationshipIndex {
  const childrenByPath = new Map<string, SourceTask[]>();
  const parentsByPath = new Map<string, string[]>();
  for (const task of graph.tasks) {
    if (task.parents.length > 0) parentsByPath.set(task.path, task.parents);
    const child = toSourceTask(task);
    for (const parent of task.parents) {
      const bucket = childrenByPath.get(parent);
      if (bucket) bucket.push(child);
      else childrenByPath.set(parent, [child]);
    }
  }
  return { childrenByPath, parentsByPath };
}

/**
 * Turn a canonical graph into the in-memory sources the bases-scoped controller
 * consumes. The Base owns the matched task set; the enrichment owns dependencies
 * + the relationship index (companion `projects` edges supersede the Base's own
 * parents in companion mode — KTD1).
 */
export function toSources(graph: TaskGraph): PerfSources {
  const matched = graph.tasks.filter((t) => t.matched).map(toSourceTask);

  // Dependency lookup keyed by dependent path (the task that is `blockedBy`).
  const depsByPath = new Map<string, SourceDependency[]>();
  for (const task of graph.tasks) {
    if (task.deps.length > 0) {
      depsByPath.set(
        task.path,
        task.deps.map((d) => ({ predecessorPath: d.predecessorPath, reltype: d.reltype, gap: d.gap })),
      );
    }
  }

  const index = buildRelationshipIndex(graph);
  const colors = statusColors(graph);

  const baseSource: DataSource = {
    capabilities: READ_ONLY,
    getTasks: async () => matched,
    // Dependencies are owned by the enrichment in bases-scoped mode.
    getDependencies: async () => [],
  };

  const enrichment: DataSource & CompanionAccessor = {
    capabilities: READ_ONLY,
    // The task SET comes from the Base; the enrichment exposes deps + relations.
    getTasks: async () => [],
    getDependencies: async (path: string) => depsByPath.get(path) ?? [],
    getStatusColors: async () => colors,
    // Read-only enrichment: no resolvable field config → composite stays read-only.
    getFieldConfig: async () => null,
    getRelationshipIndex: async () => index,
  };

  return { baseSource, enrichment };
}
