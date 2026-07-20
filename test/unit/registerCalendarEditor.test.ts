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
import { CalendarEditorView } from '../../src/editor/CalendarEditorView';

/** A fake plugin/app exposing exactly what the register module reads. */
type MenuHandler = (menu: unknown, file: unknown, source: string, leaf: unknown) => void;

function makePlugin(markedPaths: string[]) {
  const rootSplit = { id: 'root' };
  const registerView = jest.fn();
  let fileMenuHandler: MenuHandler | null = null;
  const app = {
    workspace: {
      rootSplit,
      floatingSplit: { id: 'floating' },
      getLeavesOfType: () => [] as unknown[],
      on: (event: string, handler: MenuHandler) => {
        if (event === 'file-menu') fileMenuHandler = handler;
        return {};
      },
      offref: jest.fn(),
      detachLeavesOfType: jest.fn(),
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
  return {
    plugin: { app, registerView } as never,
    rootSplit,
    registerView,
    getFileMenuHandler: () => fileMenuHandler,
  };
}

/** A fake pane menu that records the items a handler adds, with their onClick. */
function recordingMenu() {
  const items: { title: string; click: () => void }[] = [];
  const menu = {
    addItem(cb: (item: unknown) => void) {
      let title = '';
      const item = {
        setTitle(t: string) {
          title = t;
          return item;
        },
        setIcon() {
          return item;
        },
        onClick(fn: () => void) {
          items.push({ title, click: fn });
          return item;
        },
      };
      cb(item);
    },
  };
  return { menu, items };
}

/** A leaf whose view reports the given type; setViewState is spied. */
function fakeLeaf(viewType: string) {
  const setViewState = jest.fn();
  return { leaf: { view: { getViewType: () => viewType }, setViewState }, setViewState };
}

/** A leaf whose getRoot() places it in the primary workspace. */
const primaryLeaf = (root: unknown) => new WorkspaceLeaf(root);

const original = WorkspaceLeaf.prototype.setViewState;
const originalDetach = WorkspaceLeaf.prototype.detach;
afterEach(() => {
  WorkspaceLeaf.prototype.setViewState = original;
  WorkspaceLeaf.prototype.detach = originalDetach;
});

describe('registerCalendarEditor', () => {
  it('registers the editor view type', () => {
    const { plugin, registerView } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);
    expect(registerView).toHaveBeenCalledWith(CALENDAR_EDITOR_VIEW_TYPE, expect.any(Function));
    teardown();
  });

  it("offers 'View as calendar' on a markdown leaf showing a marked note", () => {
    const { plugin, getFileMenuHandler } = makePlugin(['Calendars/NZ.md']);
    const teardown = registerCalendarEditor(plugin);
    const handler = getFileMenuHandler();
    expect(handler).not.toBeNull();

    const file = new TFile();
    file.path = 'Calendars/NZ.md';
    const { leaf, setViewState } = fakeLeaf('markdown');
    const { menu, items } = recordingMenu();
    handler!(menu, file, 'more-options', leaf);

    const entry = items.find((i) => i.title === 'View as calendar');
    expect(entry).toBeDefined();
    entry!.click();
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'markdown', state: expect.objectContaining({ file: 'Calendars/NZ.md' }) }),
    );
    teardown();
  });

  it("does not offer 'View as calendar' when the leaf is not markdown", () => {
    const { plugin, getFileMenuHandler } = makePlugin(['Calendars/NZ.md']);
    const teardown = registerCalendarEditor(plugin);
    const file = new TFile();
    file.path = 'Calendars/NZ.md';
    const { leaf } = fakeLeaf(CALENDAR_EDITOR_VIEW_TYPE);
    const { menu, items } = recordingMenu();
    getFileMenuHandler()!(menu, file, 'more-options', leaf);
    expect(items).toHaveLength(0);
    teardown();
  });

  it("does not offer 'View as calendar' for an unmarked note", () => {
    const { plugin, getFileMenuHandler } = makePlugin([]); // nothing marked
    const teardown = registerCalendarEditor(plugin);
    const file = new TFile();
    file.path = 'Notes/Plain.md';
    const { leaf } = fakeLeaf('markdown');
    const { menu, items } = recordingMenu();
    getFileMenuHandler()!(menu, file, 'more-options', leaf);
    expect(items).toHaveLength(0);
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

  it('patches leaf detach and the workspace bulk-detach, restoring both on teardown', () => {
    const { plugin } = makePlugin([]);
    const beforeDetach = WorkspaceLeaf.prototype.detach;
    const beforeBulk = plugin.app.workspace.detachLeavesOfType;

    const teardown = registerCalendarEditor(plugin);
    expect(WorkspaceLeaf.prototype.detach).not.toBe(beforeDetach);
    expect(plugin.app.workspace.detachLeavesOfType).not.toBe(beforeBulk);

    teardown();
    expect(WorkspaceLeaf.prototype.detach).toBe(beforeDetach);
    expect(plugin.app.workspace.detachLeavesOfType).toBe(beforeBulk);
  });

  it('prompts before closing a calendar editor with unsaved edits, detaching only once resolved', () => {
    const { plugin, rootSplit } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);

    const leaf = new WorkspaceLeaf(rootSplit);
    const view = new CalendarEditorView(leaf as never);
    jest.spyOn(view, 'hasUnsavedEdits').mockReturnValue(true);
    let proceed: (() => void) | null = null;
    const confirmClose = jest
      .spyOn(view, 'confirmClose')
      .mockImplementation(async (run: () => void) => {
        proceed = run;
      });
    (leaf as unknown as { view: unknown }).view = view;

    // The guard fires instead of an immediate detach.
    leaf.detach();
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect((leaf as unknown as { detached: boolean }).detached).toBe(false);

    // Running the resolve callback performs the real detach.
    proceed!();
    expect((leaf as unknown as { detached: boolean }).detached).toBe(true);

    teardown();
  });

  it('does not prompt when a calendar editor is closed inside a bulk detachLeavesOfType', () => {
    const { plugin, rootSplit } = makePlugin([]);
    // A bulk detach that actually closes its leaf, so the suspend seam is real.
    const leaf = new WorkspaceLeaf(rootSplit);
    plugin.app.workspace.detachLeavesOfType = () => {
      leaf.detach();
    };
    const teardown = registerCalendarEditor(plugin);

    const view = new CalendarEditorView(leaf as never);
    jest.spyOn(view, 'hasUnsavedEdits').mockReturnValue(true);
    const confirmClose = jest.spyOn(view, 'confirmClose').mockResolvedValue(undefined);
    (leaf as unknown as { view: unknown }).view = view;

    plugin.app.workspace.detachLeavesOfType(CALENDAR_EDITOR_VIEW_TYPE);
    expect(confirmClose).not.toHaveBeenCalled();
    expect((leaf as unknown as { detached: boolean }).detached).toBe(true);

    teardown();
  });

  it('detaches an ordinary (non-editor) leaf without prompting', () => {
    const { plugin, rootSplit } = makePlugin([]);
    const teardown = registerCalendarEditor(plugin);

    const leaf = new WorkspaceLeaf(rootSplit);
    // A plain markdown leaf, not a calendar editor — the guard must let it go.
    (leaf as unknown as { view: unknown }).view = { getViewType: () => 'markdown' };
    leaf.detach();
    expect((leaf as unknown as { detached: boolean }).detached).toBe(true);

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
