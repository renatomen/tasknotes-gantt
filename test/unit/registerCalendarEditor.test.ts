/**
 * The calendar-editor registration is a GLOBAL `WorkspaceLeaf.prototype`
 * monkey-patch — the riskiest surface in the unit — so its capture, routing,
 * suspension and teardown are unit-tested here against the obsidian mock's
 * `WorkspaceLeaf`, not left to e2e alone.
 */
import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { TFile, WorkspaceLeaf } from 'obsidian';
import { registerCalendarEditor } from '../../src/editor/registerCalendarEditor';
import { CALENDAR_EDITOR_VIEW_TYPE, suspendRouting } from '../../src/editor/calendarEditorRouting';

/** A fake plugin/app exposing exactly what the register module reads. */
function makePlugin(markedPaths: string[]) {
  const rootSplit = { id: 'root' };
  const registerView = jest.fn();
  const app = {
    workspace: {
      rootSplit,
      floatingSplit: { id: 'floating' },
      getLeavesOfType: () => [] as unknown[],
      on: jest.fn(() => ({}) as unknown),
      offref: jest.fn(),
    },
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (!markedPaths.includes(path)) return null;
        const file = new TFile();
        file.path = path;
        return file;
      },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) =>
        markedPaths.includes(file.path) ? { frontmatter: { tngantt: 'calendar' } } : null,
    },
  };
  return { plugin: { app, registerView } as never, rootSplit, registerView };
}

/** A leaf whose getRoot() places it in the primary workspace. */
const primaryLeaf = (root: unknown) => new WorkspaceLeaf(root);

const original = WorkspaceLeaf.prototype.setViewState;
afterEach(() => {
  WorkspaceLeaf.prototype.setViewState = original;
});

describe('registerCalendarEditor', () => {
  it('registers the editor view type', () => {
    const { plugin, registerView } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);
    expect(registerView).toHaveBeenCalledWith(CALENDAR_EDITOR_VIEW_TYPE, expect.any(Function));
    teardown();
  });

  it('patches setViewState so a marked note on a primary leaf routes to the editor', async () => {
    const { plugin, rootSplit } = makePlugin(['Calendars/NZ.md']);
    const teardown = registerCalendarEditor(plugin);

    const leaf = primaryLeaf(rootSplit);
    await leaf.setViewState({ type: 'markdown', state: { file: 'Calendars/NZ.md' } });
    expect((leaf.lastState as { type: string }).type).toBe(CALENDAR_EDITOR_VIEW_TYPE);
    teardown();
  });

  it('leaves an unmarked note as markdown', async () => {
    const { plugin, rootSplit } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);

    const leaf = primaryLeaf(rootSplit);
    await leaf.setViewState({ type: 'markdown', state: { file: 'Notes/Plain.md' } });
    expect((leaf.lastState as { type: string }).type).toBe('markdown');
    teardown();
  });

  it('leaves a non-primary leaf alone (hover preview / embed)', async () => {
    const { plugin } = makePlugin(['Calendars/NZ.md']);
    const teardown = registerCalendarEditor(plugin);

    const popover = primaryLeaf({ id: 'popover' });
    await popover.setViewState({ type: 'markdown', state: { file: 'Calendars/NZ.md' } });
    expect((popover.lastState as { type: string }).type).toBe('markdown');
    teardown();
  });

  it('respects suspendRouting so the escape hatch is not re-routed', async () => {
    const { plugin, rootSplit } = makePlugin(['Calendars/NZ.md']);
    const teardown = registerCalendarEditor(plugin);

    const leaf = primaryLeaf(rootSplit);
    await suspendRouting(() =>
      leaf.setViewState({ type: 'markdown', state: { file: 'Calendars/NZ.md' } }),
    );
    expect((leaf.lastState as { type: string }).type).toBe('markdown');
    teardown();
  });

  it('teardown restores the original method when the patch is still installed', () => {
    const { plugin } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);
    expect(WorkspaceLeaf.prototype.setViewState).not.toBe(original);
    teardown();
    expect(WorkspaceLeaf.prototype.setViewState).toBe(original);
  });

  it('teardown leaves a later plugin’s patch intact instead of clobbering it', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { plugin } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);

    // Another plugin wraps setViewState AFTER us (Kanban does exactly this).
    const ourPatch = WorkspaceLeaf.prototype.setViewState;
    const theirPatch = function theirs(this: WorkspaceLeaf, ...args: unknown[]) {
      return ourPatch.apply(this, args as never);
    } as typeof WorkspaceLeaf.prototype.setViewState;
    WorkspaceLeaf.prototype.setViewState = theirPatch;

    teardown();
    expect(WorkspaceLeaf.prototype.setViewState).toBe(theirPatch);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    WorkspaceLeaf.prototype.setViewState = original;
  });
});
