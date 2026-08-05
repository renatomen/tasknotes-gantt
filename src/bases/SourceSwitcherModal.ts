/**
 * SourceSwitcherModal — the quick source switcher's picker. Clones the
 * CalendarPickerModal skeleton: rows re-derive from the injected provider on
 * every render so the list always shows the sources active right now, and
 * native checkboxes carry the platform's own keyboard operation (Space
 * toggles, Escape closes). Enter and arrow navigation are added per row
 * because a checkbox has no native Enter/arrow behaviour.
 *
 * Toggling writes ONLY the injected session state — never the Bases config —
 * and the state's subscribers re-apply the display filter, so the effect is
 * instant and display-only.
 *
 * @module bases/SourceSwitcherModal
 */

/* global HTMLInputElement */
import { App, Modal } from 'obsidian';
import type { ActiveSwitcherSource, SourceSwitcherState } from './sourceSwitcher';

export interface SourceSwitcherDeps {
  /** The sources currently active (enabled AND non-empty); re-read every render. */
  getActiveSources: () => readonly ActiveSwitcherSource[];
  /** The view's session-scoped hidden-source state. */
  state: SourceSwitcherState;
}

export class SourceSwitcherModal extends Modal {
  private readonly deps: SourceSwitcherDeps;
  private checkboxes: HTMLInputElement[] = [];

  constructor(app: App, deps: SourceSwitcherDeps) {
    super(app);
    this.deps = deps;
    this.setTitle('Quick source switcher');
  }

  onOpen(): void {
    this.render(0);
  }

  private render(focusIndex: number): void {
    const sources = this.deps.getActiveSources();
    const { contentEl } = this;
    contentEl.empty();
    this.checkboxes = [];

    if (sources.length === 0) {
      contentEl.createEl('p', { text: 'No calendar-item sources are active in this view.' });
      return;
    }

    const list = contentEl.createDiv({ cls: 'og-source-switcher-list' });
    sources.forEach((source, index) => this.renderSourceRow(list, source, index));
    this.checkboxes[Math.min(focusIndex, this.checkboxes.length - 1)]?.focus();
  }

  private renderSourceRow(list: HTMLElement, source: ActiveSwitcherSource, index: number): void {
    const row = list.createDiv({ cls: 'og-source-switcher-row' });
    const label = row.createEl('label', { cls: 'og-source-switcher-row-main' });
    const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = !this.deps.state.isHidden(source.family);
    checkbox.addEventListener('change', () => this.toggleSource(source, index));
    checkbox.addEventListener('keydown', (event) => this.handleRowKey(event, source, index));
    label.createEl('span', { cls: 'og-source-switcher-name', text: source.label });
    this.checkboxes.push(checkbox);
  }

  private toggleSource(source: ActiveSwitcherSource, index: number): void {
    this.deps.state.toggle(source.family);
    // Re-render from fresh state, keeping focus on the toggled row so keyboard
    // operation continues without re-tabbing into the list.
    this.render(index);
  }

  private handleRowKey(event: KeyboardEvent, source: ActiveSwitcherSource, index: number): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.toggleSource(source, index);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.checkboxes[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
    // Space is the checkbox's own native toggle — handling it here would
    // toggle the row twice.
  }
}
