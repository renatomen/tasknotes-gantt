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
/* global HTMLInputElement */
import { ItemView, Notice, TFile, WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { mount, unmount } from 'svelte';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import { resolveParentLink } from '../bases/parentLink';
import { classifyMember, type MemberResolution } from './unionPreview';
import {
  CALENDAR_EDITOR_VIEW_TYPE,
  displayNameFor,
  shouldHealToMarkdown,
  suspendRouting,
} from './calendarEditorRouting';
import CalendarEditorForm from './CalendarEditorForm.svelte';
import { formFromFrontmatter } from './calendarEditorState';
import { editFrontmatterKeys, type FrontmatterValue } from './frontmatterEdit';
import { WikilinkInputSuggest } from '../bases/wikilinkInputSuggest';
import { createVaultWikilinkFetcher } from '../bases/vaultWikilinkSuggest';
import { TimezoneInputSuggest } from '../bases/timezoneInputSuggest';
import { UnsavedCalendarModal } from './UnsavedCalendarModal';
import { noteBasename, renameTargetPath } from './noteName';

/** The imperative surface the form exports to its host (see the .svelte file). */
interface FormHandle {
  markExternalChange?: () => void;
  hasUnsavedEdits?: () => boolean;
  canSave?: () => boolean;
  save?: () => Promise<void>;
}

export class CalendarEditorView extends ItemView {
  private filePath: string | null = null;
  private form: (ReturnType<typeof mount> & FormHandle) | null = null;
  /** Raw text the mounted form reflects — the baseline for external-write detection. */
  private lastContent: string | null = null;
  private headingEl: HTMLElement | null = null;

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
    // Only a string file changes the target; an ephemeral setState (scroll,
    // focus) carries no file and must NOT wipe the path the form saves against.
    if (typeof file === 'string') this.filePath = file;
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
        // A rename changes only the path, not the content. Rebuilding the form
        // would discard unsaved edits, so keep it mounted when dirty (the save
        // already targets the live path) and just refresh the heading; a clean
        // form can safely rebuild.
        if (this.form?.hasUnsavedEdits?.()) {
          this.headingEl?.setText(this.getDisplayText());
        } else {
          this.render();
        }
      }),
    );
    // The marker can disappear UNDER an open editor — a hand edit or an
    // external sync — and Obsidian does not re-invoke setState for that, so
    // healing has to watch the metadata cache rather than a lifecycle hook.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file, data) => {
        if (file.path !== this.filePath) return;
        if (shouldHealToMarkdown(this.filePath, this.hasMarker(file.path))) {
          void this.openAsMarkdown();
          return;
        }
        // A write we did not make, while the editor is open. With unsaved edits,
        // surface the reload-or-keep banner; with none, refresh silently so the
        // controls never show — or save from — stale values (no focus steal).
        if (this.lastContent !== null && data !== this.lastContent) {
          if (this.form?.hasUnsavedEdits?.()) {
            this.form.markExternalChange?.();
          } else {
            this.render(false);
          }
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

  /**
   * Resolve one set-member link to a member calendar for the live union preview.
   * A link that resolves to no file is `unresolved`; a note that resolves but is
   * not a valid calendar — an invalid note, or a calendar-set (sets are flat) —
   * is `invalid`. Only a valid calendar returns `ok`, so the two degradation
   * categories stay distinct in the set banner.
   */
  private resolveMember(link: string): MemberResolution {
    return classifyMember(link, (strippedLink) => {
      const path = resolveParentLink(this.app, strippedLink, this.filePath ?? '');
      if (path === null) return null;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return null;
      return { frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter };
    });
  }

  private hasMarker(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return matchesCalendarMarker(frontmatter) !== null;
  }

  /** Whether the open form has edits not yet written — the close guard reads
      this to decide whether to prompt before the leaf detaches. */
  hasUnsavedEdits(): boolean {
    return this.form?.hasUnsavedEdits?.() ?? false;
  }

  /**
   * Offer the unsaved-changes choice, then run `proceed` (the actual detach)
   * only when the edits are resolved. Save failures keep the editor open with
   * the edits intact rather than closing over a write that never landed.
   */
  async confirmClose(proceed: () => void): Promise<void> {
    const canSave = this.form?.canSave?.() ?? false;
    const choice = await new UnsavedCalendarModal(this.app, canSave).openAndGetChoice();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      try {
        await this.form?.save?.();
      } catch {
        return;
      }
    }
    proceed();
  }

  async onClose(): Promise<void> {
    this.destroyForm();
  }

  private destroyForm(): void {
    if (this.form) {
      try {
        void unmount(this.form);
      } catch {
        /* already gone */
      }
      this.form = null;
    }
  }

  private render(focusDescription = true): void {
    this.destroyForm();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('og-calendar-editor');
    if (this.filePath === null) {
      this.headingEl = null;
      contentEl.createEl('p', { text: 'No calendar note open.' });
      return;
    }
    this.headingEl = contentEl.createEl('h2', { text: this.getDisplayText() });

    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    this.form = mount(CalendarEditorForm, {
      target: contentEl,
      props: {
        initial: formFromFrontmatter(frontmatter),
        // The calendar name is its filename; the form edits it and asks the host
        // to rename on save, so the note can be renamed without leaving the editor.
        initialName: noteBasename(this.filePath),
        onRename: (newName: string) => this.rename(newName),
        // The live path, not a captured one: after a rename the save must target
        // the note's new path. setState never nulls filePath (it only updates on
        // a string file), so reading it at save time is safe.
        onSave: (changes: Record<string, FrontmatterValue>) => this.persist(this.filePath, changes),
        onReload: () => this.render(),
        autofocus: focusDescription,
        attachMemberSuggest: (input: HTMLInputElement) => {
          // The suggester's popover and keymap scope live on document.body, so
          // they outlive the input unless closed — return a disposer the form
          // calls when the row unmounts (matches TextCellEditor's teardown).
          const suggest = new WikilinkInputSuggest(
            this.app,
            input,
            createVaultWikilinkFetcher(this.app, this.filePath ?? ''),
          );
          return () => suggest.close();
        },
        attachTimezoneSuggest: (input: HTMLInputElement) => {
          const suggest = new TimezoneInputSuggest(this.app, input);
          return () => suggest.close();
        },
        resolveMember: (link: string) => this.resolveMember(link),
      },
    }) as ReturnType<typeof mount> & FormHandle;

    // Seed the external-write baseline from the current disk text. Until it
    // resolves, the metadata listener holds off (lastContent stays null), so a
    // freshly opened note never mistakes its own initial parse for an edit.
    this.lastContent = null;
    this.app.vault
      .read(file)
      .then((text) => {
        this.lastContent = text;
      })
      .catch(() => {
        /* unreadable — leave detection disarmed rather than false-flag */
      });
  }

  /**
   * Rename the note to `newName` within its own folder, updating backlinks via
   * the file manager. Refuses a name that would collide with an existing note.
   * The rename event listener (onOpen) then updates filePath and the heading.
   */
  private async rename(newName: string): Promise<void> {
    const file =
      this.filePath === null ? null : this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      new Notice("Couldn't rename the calendar note — it no longer exists.");
      throw new Error('Calendar note not found for rename');
    }
    const target = renameTargetPath(file.path, newName);
    if (target === file.path) return;
    const existing = this.app.vault.getAbstractFileByPath(target);
    if (existing !== null && existing !== file) {
      new Notice(`A note named "${newName.trim()}" already exists in this folder.`);
      throw new Error('Rename target already exists');
    }
    await this.app.fileManager.renameFile(file, target);
  }

  /** Write the form's change set through the comment-preserving editor. */
  private async persist(
    path: string | null,
    changes: Record<string, FrontmatterValue>,
  ): Promise<void> {
    const file = path === null ? null : this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      // The note was deleted or moved out from under the editor. Fail loudly so
      // the form keeps the unsaved edits instead of treating this as a success.
      new Notice("Couldn't save the calendar note — it no longer exists.");
      throw new Error(`Calendar note not found: ${path ?? '(no path)'}`);
    }
    try {
      // Atomic read-modify-write: the transform runs on the freshest content, so
      // an external write landing between read and write can't be clobbered by a
      // stale snapshot. editFrontmatterKeys rewrites only the changed keys and
      // leaves unrelated frontmatter, comments, and body intact.
      const updated = await this.app.vault.process(file, (data) =>
        editFrontmatterKeys(data, changes),
      );
      // Our own write is now the disk truth; keep it out of external detection.
      this.lastContent = updated;
    } catch (error) {
      console.error('[Gantt] Failed to save the calendar note:', error);
      new Notice("Couldn't save the calendar note — see console for details.");
      throw error;
    }
  }
}

interface MenuItemLike {
  setTitle(title: string): MenuItemLike;
  setIcon(icon: string): MenuItemLike;
  onClick(handler: () => void): MenuItemLike;
}

