/**
 * Confirmation dialog for an inferred-edge drag (plan U3).
 *
 * When a resize moves an edge whose date is inferred from the time-estimate, this
 * asks whether to grow the **estimate only** (leave the date computed) or the
 * **estimate and dates** (also pin a real date), instead of writing silently.
 *
 * Mirrors {@link ./CascadeConfirmModal}'s structure (hosted via `app`; title +
 * body + a `Setting` button row; `onClose` resolves cancel; a promise result)
 * with two deliberate differences from that modal:
 *
 * - It resolves a richer `{ action, dontAskAgain }` (or `null` on cancel), not a
 *   bare boolean.
 * - It adds a net-new "Don't ask again" toggle (R6) — the cascade modal has none.
 *
 * Focus/Enter safety: **Estimate only** is the sole primary (mod-cta) and is
 * default-focused because it is the conservative action (grows the estimate,
 * materialises no date), so Enter picks it and Escape/backdrop cancels. Unlike
 * {@link ./CascadeConfirmModal} there is no Cancel button to focus — cancel is
 * Escape/backdrop only.
 *
 * @module bases/InferredDragModal
 */

/* global HTMLButtonElement */
import { App, Modal, Setting } from 'obsidian';
import type { InferredDragAction } from './inferredDragGate';

/** The user's resolved choice: which action, and whether to stop asking. */
export interface InferredDragChoice {
  action: InferredDragAction;
  dontAskAgain: boolean;
}

export class InferredDragModal extends Modal {
  private resolved = false;
  private resolve!: (value: InferredDragChoice | null) => void;
  private dontAskAgain = false;

  constructor(app: App) {
    super(app);
  }

  /**
   * Open the modal and resolve the chosen `{ action, dontAskAgain }`, or `null`
   * when the user cancels (Escape / backdrop dismiss).
   */
  openAndGetChoice(): Promise<InferredDragChoice | null> {
    return new Promise<InferredDragChoice | null>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private finish(value: InferredDragChoice | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText('Inferred date — grow the estimate?');
    contentEl
      .createEl('p')
      .setText(
        "This edge's date is inferred from the time estimate. Grow just the " +
          'estimate (the date stays computed), or grow the estimate and pin a ' +
          'real date here?',
      );

    // Net-new "Don't ask again" toggle (the cascade modal has none), above the
    // action buttons and before them in tab order.
    new Setting(contentEl)
      .setName("Don't ask again")
      .setDesc('Apply this choice to future inferred-edge drags in this view.')
      .addToggle((toggle) => toggle.setValue(false).onChange((value) => (this.dontAskAgain = value)));

    let estimateOnlyButtonEl: HTMLButtonElement | undefined;
    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText('Estimate only')
          .setCta() // primary styling (mod-cta) — the conservative choice
          .onClick(() => this.finish({ action: 'estimate-only', dontAskAgain: this.dontAskAgain }));
        estimateOnlyButtonEl = btn.buttonEl;
      })
      .addButton((btn) =>
        btn
          .setButtonText('Estimate and dates')
          .onClick(() =>
            this.finish({ action: 'estimate-and-dates', dontAskAgain: this.dontAskAgain }),
          ),
      );

    // Default focus on the conservative CTA so Enter grows the estimate without
    // materialising a date (no reflexive silent write).
    estimateOnlyButtonEl?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    // Escape / backdrop dismiss resolves as cancel so the caller always settles.
    this.finish(null);
  }
}
