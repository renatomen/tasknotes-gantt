/**
 * CalendarPickerModal — the multi-select calendar picker, the feature's
 * always-reachable front door. Thin DOM wiring over the pure row/transition
 * model in {@link module:bases/calendarPickerModel}: rows re-derive from a
 * fresh context after every persisted change, so the modal always shows the
 * resolved present. Native controls only (real checkboxes, a real expand
 * button) — keyboard operation and Escape-to-close come from the platform,
 * not bespoke key handling.
 *
 * @module bases/CalendarPickerModal
 */

/* global HTMLInputElement */
import { App, Modal } from 'obsidian';
import {
  buildPickerRows,
  toggleCalendarRow,
  toggleDefaultRow,
  toggleSetMember,
  toggleSetRow,
  type CalendarRowModel,
  type PickerContext,
  type PickerTransition,
  type PickerWrites,
  type SetRowModel,
} from './calendarPickerModel';

export interface CalendarPickerDeps {
  /** Fresh resolution state; re-read after every persisted change. */
  getContext: () => PickerContext;
  /** Persist selection writes into the view config (both keys when present). */
  persist: (writes: PickerWrites) => void;
  /** Scaffold a new calendar note and open it (empty-vault path). */
  createCalendar: () => Promise<void>;
}

export class CalendarPickerModal extends Modal {
  private readonly deps: CalendarPickerDeps;
  private readonly expandedSets = new Set<string>();

  constructor(app: App, deps: CalendarPickerDeps) {
    super(app);
    this.deps = deps;
    this.setTitle('Select calendars');
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const context = this.deps.getContext();
    const rows = buildPickerRows(context);
    const { contentEl } = this;
    contentEl.empty();

    const calendarsPresent = rows.some((row) => row.kind !== 'default');
    if (!calendarsPresent) {
      this.renderEmptyState(contentEl);
      return;
    }

    const list = contentEl.createDiv({ cls: 'og-cal-picker-list' });
    let firstCheckbox: HTMLInputElement | null = null;
    for (const row of rows) {
      let checkbox: HTMLInputElement | null = null;
      if (row.kind === 'default') {
        checkbox = this.renderToggleRow(list, {
          name: 'Default calendar',
          description: 'Weekend shading for tasks with no calendar',
          checked: row.enabled,
          onToggle: () => this.apply(toggleDefaultRow(context)),
        });
      } else if (row.kind === 'calendar') {
        checkbox = this.renderCalendarRow(list, context, row);
      } else if (row.kind === 'set') {
        checkbox = this.renderSetRow(list, context, row);
      } else {
        this.renderFlaggedRow(list, row.label, row.reason);
      }
      firstCheckbox ??= checkbox;
    }
    firstCheckbox?.focus();
  }

  private renderCalendarRow(
    list: HTMLElement,
    context: PickerContext,
    row: CalendarRowModel,
  ): HTMLInputElement {
    return this.renderToggleRow(list, {
      name: row.name,
      description: row.description,
      color: row.color,
      checked: row.checked,
      onToggle: () => this.apply(toggleCalendarRow(context, row)),
    });
  }

  private renderSetRow(
    list: HTMLElement,
    context: PickerContext,
    row: SetRowModel,
  ): HTMLInputElement {
    const checkbox = this.renderToggleRow(list, {
      name: row.name,
      description: row.description,
      color: row.color,
      checked: row.state === 'all',
      indeterminate: row.state === 'partial',
      onToggle: () => this.apply(toggleSetRow(context, row)),
      expand: {
        expanded: this.expandedSets.has(row.path),
        onExpand: () => {
          if (!this.expandedSets.delete(row.path)) this.expandedSets.add(row.path);
          this.render();
        },
      },
    });
    if (this.expandedSets.has(row.path)) {
      const memberList = list.createDiv({ cls: 'og-cal-picker-members' });
      for (const member of row.members) {
        this.renderToggleRow(memberList, {
          name: member.name,
          checked: member.checked,
          onToggle: () => this.apply(toggleSetMember(context, row, member)),
        });
      }
    }
    return checkbox;
  }

  private renderToggleRow(
    parent: HTMLElement,
    options: {
      name: string;
      description?: string;
      color?: string;
      checked: boolean;
      indeterminate?: boolean;
      onToggle: () => void;
      expand?: { expanded: boolean; onExpand: () => void };
    },
  ): HTMLInputElement {
    const row = parent.createDiv({ cls: 'og-cal-picker-row' });
    const label = row.createEl('label', { cls: 'og-cal-picker-row-main' });
    const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = options.checked;
    checkbox.indeterminate = options.indeterminate === true;
    checkbox.addEventListener('change', options.onToggle);
    if (options.color) {
      label.createEl('span', {
        cls: 'og-cal-picker-swatch',
        attr: { style: `background-color: ${options.color}` },
      });
    }
    label.createEl('span', { cls: 'og-cal-picker-name', text: options.name });
    if (options.description) {
      row.createEl('small', { cls: 'og-cal-picker-desc', text: options.description });
    }
    if (options.expand) {
      const button = row.createEl('button', {
        cls: 'og-cal-picker-expand',
        text: options.expand.expanded ? 'Hide members' : 'Show members',
      });
      button.addEventListener('click', options.expand.onExpand);
    }
    return checkbox;
  }

  private renderFlaggedRow(list: HTMLElement, label: string, reason: string): void {
    const row = list.createDiv({ cls: 'og-cal-picker-row og-cal-picker-row-flagged' });
    const main = row.createEl('label', { cls: 'og-cal-picker-row-main' });
    const checkbox = main.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.disabled = true;
    main.createEl('span', { cls: 'og-cal-picker-name', text: label });
    row.createEl('small', { cls: 'og-cal-picker-desc', text: reason });
  }

  private renderEmptyState(contentEl: HTMLElement): void {
    contentEl.createEl('p', {
      text: 'No calendars in this vault yet. A calendar is a note with tngantt: calendar in its frontmatter.',
    });
    const button = contentEl.createEl('button', {
      cls: 'mod-cta',
      text: 'Create calendar',
    });
    button.addEventListener('click', () => {
      // Close only on success; a failed create keeps the modal (and its
      // action) available — the dep surfaces the failure to the user.
      void this.deps
        .createCalendar()
        .then(() => this.close())
        .catch(() => undefined);
    });
    button.focus();
  }

  private apply(transition: PickerTransition): void {
    if (transition.writes) this.deps.persist(transition.writes);
    this.render();
  }
}
