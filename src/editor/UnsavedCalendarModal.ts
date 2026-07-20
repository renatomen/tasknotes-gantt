/**
 * The close-without-saving guard for the calendar editor.
 *
 * Obsidian has no cancelable "before close" hook for a custom view, so closing
 * a dirty editor is intercepted at `WorkspaceLeaf.detach` (see
 * registerCalendarEditor). This modal is the choice that interception offers:
 * save the edits, discard them, or go back and keep editing.
 *
 * `openAndGetChoice()` resolves the chosen action. Escape / backdrop dismiss
 * resolves `'cancel'` (go back) so a reflex dismiss never loses work, and that
 * non-destructive choice is default-focused so Enter never discards.
 *
 * @module editor/UnsavedCalendarModal
 */
/* global HTMLButtonElement */
import { App, Modal, Setting } from 'obsidian';

/** What the user chose when closing a calendar note with unsaved edits. */
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export class UnsavedCalendarModal extends Modal {
  private resolved = false;
  private resolve!: (value: UnsavedChoice) => void;

  /**
   * @param canSave Whether saving is currently possible (dirty, valid, idle).
   *   When false the Save button is disabled — the note has an error or a save
   *   already in flight — so the only ways out are Discard or Go back.
   */
  constructor(
    app: App,
    private readonly canSave: boolean,
  ) {
    super(app);
  }

  openAndGetChoice(): Promise<UnsavedChoice> {
    return new Promise<UnsavedChoice>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private finish(value: UnsavedChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText('Unsaved calendar changes');
    contentEl
      .createEl('p')
      .setText('This calendar note has changes you haven’t saved. What would you like to do?');

    let goBackButtonEl: HTMLButtonElement | undefined;
    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText('Go back').onClick(() => this.finish('cancel'));
        goBackButtonEl = btn.buttonEl;
      })
      .addButton((btn) =>
        btn.setButtonText('Discard').setWarning().onClick(() => this.finish('discard')),
      )
      .addButton((btn) => {
        btn.setButtonText('Save').setCta().onClick(() => this.finish('save'));
        btn.setDisabled(!this.canSave);
      });

    // Default focus on the non-destructive choice: Enter keeps the edits.
    goBackButtonEl?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    // Escape / backdrop dismiss keeps the editor open rather than lose work.
    this.finish('cancel');
  }
}
