/**
 * Wires the calendar editor into Obsidian: registers the view type and
 * intercepts `WorkspaceLeaf.setViewState` so a marked note routes to the
 * editor BEFORE the markdown view constructs — no flash, no `file-open` loop.
 *
 * The interception is a prototype patch (the shape Kanban uses), which makes
 * teardown load-bearing: unregistering restores the original method and
 * reverts open editor leaves to markdown, so disabling the plugin leaves every
 * calendar note opening as ordinary markdown.
 *
 * Decisions live in `calendarEditorRouting.ts`; this module is the glue that
 * supplies Obsidian-shaped facts to them.
 *
 * @module editor/registerCalendarEditor
 */
import { TFile, WorkspaceLeaf, type App, type Plugin } from 'obsidian';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import {
  CALENDAR_EDITOR_VIEW_TYPE,
  createReentrancyGuard,
  isRoutingSuspended,
  routeViewState,
  type ViewStateLike,
} from './calendarEditorRouting';
import { CalendarEditorView } from './CalendarEditorView';

/**
 * Register the editor. Returns a teardown that restores the patched method and
 * drops open editor leaves back to markdown.
 */
export function registerCalendarEditor(plugin: Plugin): () => void {
  const app = plugin.app;
  plugin.registerView(CALENDAR_EDITOR_VIEW_TYPE, (leaf) => new CalendarEditorView(leaf));

  const guard = createReentrancyGuard();
  const original = WorkspaceLeaf.prototype.setViewState;

  // The casts are the monkey-patch idiom: the replacement must accept the same
  // arguments Obsidian passes without re-declaring its overloads.
  const patched = function patched(
    this: WorkspaceLeaf,
    state: ViewStateLike,
    ...rest: unknown[]
  ) {
    let routed: ViewStateLike | null = null;
    if (!isRoutingSuspended()) {
      guard.run(() => {
        routed = routeViewState(state, {
          isPrimaryLeaf: isPrimaryLeaf(app, this),
          markerFor: (path) => markerFor(app, path),
        });
      });
    }
    return original.call(this, (routed ?? state) as never, ...(rest as [never]));
  } as typeof WorkspaceLeaf.prototype.setViewState;

  WorkspaceLeaf.prototype.setViewState = patched;

  return () => {
    // Identity check before restoring: another plugin (Kanban patches this same
    // method) may have wrapped ours since. Blindly restoring our snapshot would
    // silently discard their patch, so leave the chain alone in that case.
    if (WorkspaceLeaf.prototype.setViewState === patched) {
      WorkspaceLeaf.prototype.setViewState = original;
    } else {
      console.warn(
        '[Gantt] setViewState was re-patched by another plugin; leaving the chain intact.',
      );
    }
    revertOpenEditors(app);
  };
}

/**
 * Whether this leaf is a primary workspace leaf. Hover popovers, embeds and
 * canvas cards live outside the root split and must keep rendering markdown —
 * the markdown floor is what makes this feature safe to disable.
 */
function isPrimaryLeaf(app: App, leaf: WorkspaceLeaf): boolean {
  const root = (leaf as unknown as { getRoot?: () => unknown }).getRoot?.();
  // Fail CLOSED: a leaf-like object we cannot place (a canvas shim, a future
  // internal) renders markdown. The floor is the safe answer, never the editor.
  if (root === undefined) return false;
  const workspace = app.workspace as unknown as { rootSplit?: unknown; floatingSplit?: unknown };
  // A popover's root is neither split; a detached window's floatingSplit still
  // hosts real leaves, so it counts as primary.
  return root === workspace.rootSplit || root === workspace.floatingSplit;
}

function markerFor(app: App, path: string): string | null {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  return matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter);
}

/** Drop every open editor leaf back to markdown (plugin unload). */
function revertOpenEditors(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType(CALENDAR_EDITOR_VIEW_TYPE)) {
    const file = (leaf.view as unknown as { getState?: () => { file?: unknown } }).getState?.()?.file;
    void leaf.setViewState({
      type: 'markdown',
      state: { file: typeof file === 'string' ? file : undefined, mode: 'source' },
    });
  }
}
