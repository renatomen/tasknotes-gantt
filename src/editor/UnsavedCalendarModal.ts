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
import { App, Modal } from 'obsidian';

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

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText('Unsaved calendar changes');
    contentEl.createEl('p', {
      text: 'This calendar note has changes you haven’t saved. What would you like to do?',
    });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });

    const goBack = buttons.createEl('button', { text: 'Go back' });
    goBack.addEventListener('click', () => this.finish('cancel'));

    const discard = buttons.createEl('button', { cls: 'mod-warning', text: 'Discard' });
    discard.addEventListener('click', () => this.finish('discard'));

    const save = buttons.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.disabled = !this.canSave;
    // A disabled button emits no click in the DOM, but guard the handler too so
    // the intent (no save when it can't) does not depend on that alone.
    save.addEventListener('click', () => {
      if (this.canSave) this.finish('save');
    });

    // Default focus on the non-destructive choice: Enter keeps the edits.
    goBack.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    // Escape / backdrop dismiss keeps the editor open rather than lose work.
    this.finish('cancel');
  }
}
