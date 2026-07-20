/**
 * The calendar-note editor view — U14 ships the routing shell with a
 * placeholder body; U15 fills in the form.
 *
 * Markdown is a guaranteed floor, so this view heals itself: on every
 * `setState` it re-checks the note's marker and swaps the leaf back to
 * markdown when it is gone. That covers a workspace restored from a session
 * where the plugin was disabled and the marker was since removed — an open
 * editor leaf unavoidably serializes its view type, so the floor has to be a
 * self-healing contract rather than a never-persist claim.
 *
 * Healing is lazy by design: a deferred leaf (Obsidian 1.7+) heals when it is
 * revealed, so nothing forces materialization of leaves the user never opens.
 *
 * @module editor/CalendarEditorView
 */
import { ItemView, TFile, WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import {
  CALENDAR_EDITOR_VIEW_TYPE,
  displayNameFor,
  shouldHealToMarkdown,
  suspendRouting,
} from './calendarEditorRouting';

export class CalendarEditorView extends ItemView {
  private filePath: string | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CALENDAR_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return displayNameFor(this.filePath);
  }

  getIcon(): string {
    return 'calendar-range';
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = (state as { file?: unknown } | null)?.file;
    this.filePath = typeof file === 'string' ? file : null;
    await super.setState(state, result);
    // Heal before rendering, so a markerless note never flashes the editor.
    if (shouldHealToMarkdown(this.filePath, this.filePath !== null && this.hasMarker(this.filePath))) {
      await this.openAsMarkdown();
      return;
    }
    this.render();
  }

  getState(): Record<string, unknown> {
    return { ...(super.getState() as Record<string, unknown>), file: this.filePath };
  }

  async onOpen(): Promise<void> {
    // ItemView is not a FileView, so nothing updates the tab title on rename.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (oldPath !== this.filePath) return;
        this.filePath = file.path;
        this.render();
      }),
    );
    // The marker can disappear UNDER an open editor — a hand edit or an
    // external sync — and Obsidian does not re-invoke setState for that, so
    // healing has to watch the metadata cache rather than a lifecycle hook.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file.path !== this.filePath) return;
        if (shouldHealToMarkdown(this.filePath, this.hasMarker(file.path))) {
          void this.openAsMarkdown();
        }
      }),
    );
    this.render();
  }

  onPaneMenu(menu: { addItem: (cb: (item: MenuItemLike) => void) => void }): void {
    menu.addItem((item) => {
      item
        .setTitle('Open as markdown')
        .setIcon('file-text')
        .onClick(() => {
          void this.openAsMarkdown();
        });
    });
  }

  /**
   * The always-available escape hatch to the markdown floor. Routing is
   * suspended for the call: the note still carries its marker, so the
   * interceptor would otherwise rewrite this straight back to the editor.
   */
  async openAsMarkdown(): Promise<void> {
    await suspendRouting(() =>
      this.leaf.setViewState({
        type: 'markdown',
        state: { file: this.filePath, mode: 'source' },
        active: true,
      }),
    );
  }

  private hasMarker(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return matchesCalendarMarker(frontmatter) !== null;
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('og-calendar-editor');
    contentEl.createEl('h2', { text: this.getDisplayText() });
    contentEl.createEl('p', {
      text: 'Calendar editor — the form arrives in the next unit. Use the pane menu to open this note as markdown.',
    });
  }
}

interface MenuItemLike {
  setTitle(title: string): MenuItemLike;
  setIcon(icon: string): MenuItemLike;
  onClick(handler: () => void): MenuItemLike;
}

