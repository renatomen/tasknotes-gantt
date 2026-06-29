/**
 * FocusTaskModal — native Obsidian fuzzy search over the chart's tasks.
 *
 * Lists every render instance currently in the chart (matched + extended),
 * deduped to one entry per source note, and fuzzy-matches over the task name +
 * source path. Picking a task invokes `onChoose(id)`, which the Gantt view turns
 * into a focus navigation (expand → zoom → scroll → highlight). The modal holds
 * no business logic — dedupe and match-text are the pure helpers from
 * {@link module:bases/focusController}.
 *
 * @module bases/FocusTaskModal
 */

import { App, FuzzySuggestModal, type FuzzyMatch } from 'obsidian';
import {
  dedupeInstancesBySource,
  focusItemText,
  type FocusInstance,
} from './focusController';

/** Fuzzy "focus on task" picker; returns the chosen instance id via `onChoose`. */
export class FocusTaskModal extends FuzzySuggestModal<FocusInstance> {
  private readonly items: FocusInstance[];
  private readonly onChoose: (id: string) => void;

  /**
   * @param app - the Obsidian app (modal host)
   * @param instances - the chart's render instances (deduped internally by source)
   * @param onChoose - invoked with the chosen instance id
   */
  constructor(app: App, instances: FocusInstance[], onChoose: (id: string) => void) {
    super(app);
    this.items = dedupeInstancesBySource(instances);
    this.onChoose = onChoose;
    this.setPlaceholder('Search tasks by name or path…');
  }

  getItems(): FocusInstance[] {
    return this.items;
  }

  /** Fuzzy-match string: task name + source path (R3). */
  getItemText(item: FocusInstance): string {
    return focusItemText(item);
  }

  /**
   * Two-line suggestion: task name (primary) over the source path (secondary).
   * Overriding the default deliberately drops the fuzzy-match highlight spans in
   * exchange for the name/path layout; matching itself still runs over both
   * (see {@link getItemText}).
   */
  renderSuggestion(match: FuzzyMatch<FocusInstance>, el: HTMLElement): void {
    const { item } = match;
    el.createEl('div', { text: item.text, cls: 'og-focus-suggestion-title' });
    el.createEl('small', { text: item.sourcePath, cls: 'og-focus-suggestion-path' });
  }

  onChooseItem(item: FocusInstance): void {
    this.onChoose(item.id);
  }
}
