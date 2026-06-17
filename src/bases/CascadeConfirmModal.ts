/**
 * Generic confirm dialog for the Gantt parent-date interactions (plan U3).
 *
 * Used for two prompts, both shaped as "here's what would change to these
 * tasks — confirm or cancel", with a scrollable current → proposed list and an
 * all-or-nothing choice:
 *
 * - **Extend** (a moved task/subtree now exceeds ancestors): confirm = extend
 *   all listed ancestors; cancel = leave the overflow (the move is already saved).
 * - **Shrink-fit** (a parent was resized below its children): confirm = adjust
 *   the parent to wrap its children; cancel = undo the resize.
 *
 * `openAndGetChoice()` resolves `true` for the primary (confirm) button and
 * `false` for Cancel / Escape / backdrop dismiss. The non-destructive button is
 * default-focused so Enter never confirms by reflex.
 *
 * @module bases/CascadeConfirmModal
 */

/* global HTMLButtonElement */
import { App, Modal, Setting } from 'obsidian';

/** One current → proposed row. */
export interface CascadeRow {
  name: string;
  oldStart: Date | null;
  oldEnd: Date | null;
  newStart: Date;
  newEnd: Date;
}

export interface CascadeConfirmOpts {
  title: string;
  body: string;
  confirmText: string;
  cancelText?: string;
  rows: ReadonlyArray<CascadeRow>;
}

/** Format a date as `YYYY-MM-DD` (local), matching the Gantt's bar dates. */
function fmt(date: Date | null): string {
  if (!date) return '—';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class CascadeConfirmModal extends Modal {
  private readonly opts: CascadeConfirmOpts;
  private resolved = false;
  private resolve!: (value: boolean) => void;

  constructor(app: App, opts: CascadeConfirmOpts) {
    super(app);
    this.opts = opts;
  }

  /** Open the modal and resolve `true` (confirm) or `false` (cancel/dismiss). */
  openAndGetChoice(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.opts.title);
    contentEl.createEl('p').setText(this.opts.body);

    // Scrollable list so a long set never pushes the buttons offscreen.
    const list = contentEl.createDiv({ cls: 'og-cascade-list' });
    list.style.maxHeight = '40vh';
    list.style.overflowY = 'auto';
    list.style.margin = '0.5em 0';
    for (const r of this.opts.rows) {
      const row = list.createDiv({ cls: 'og-cascade-row' });
      row.style.padding = '2px 0';
      const name = row.createSpan({ cls: 'og-cascade-name' });
      name.setText(r.name);
      name.style.fontWeight = '600';
      row.createSpan({ text: `  ${fmt(r.oldStart)}–${fmt(r.oldEnd)} → ${fmt(r.newStart)}–${fmt(r.newEnd)}` });
    }

    let cancelButtonEl: HTMLButtonElement | undefined;
    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText(this.opts.cancelText ?? 'Cancel').onClick(() => this.finish(false));
        cancelButtonEl = btn.buttonEl;
      })
      .addButton((btn) =>
        btn
          .setButtonText(this.opts.confirmText)
          .setCta() // primary styling (mod-cta)
          .onClick(() => this.finish(true)),
      );

    // Default focus on the non-destructive choice so Enter doesn't confirm by reflex.
    cancelButtonEl?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    // Escape / backdrop dismiss resolves as Cancel so the caller always settles.
    this.finish(false);
  }
}
