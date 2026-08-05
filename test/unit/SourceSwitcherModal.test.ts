/**
 * Quick source switcher modal: DOM wiring over the injected session state and
 * active-source provider, exercised against the obsidian mock's recording
 * Modal/FakeElement. Toggling writes ONLY the session state (instant display
 * effect through its subscribers) — never a Bases config key.
 */

import { describe, expect, it } from '@jest/globals';
import { App, FakeElement } from 'obsidian';
import {
  createSourceSwitcherState,
  type ActiveSwitcherSource,
} from '../../src/bases/sourceSwitcher';
import { SourceSwitcherModal } from '../../src/bases/SourceSwitcherModal';

const ACTIVE: ActiveSwitcherSource[] = [
  { family: 'recurring-instance', label: 'Recurring tasks' },
  { family: 'time-entry', label: 'Time entries' },
];

function openSwitcher(
  active: readonly ActiveSwitcherSource[] = ACTIVE,
  state = createSourceSwitcherState(),
) {
  const modal = new SourceSwitcherModal(new App(), {
    getActiveSources: () => active,
    state,
  });
  modal.open();
  return { modal, state, contentEl: modal.contentEl as unknown as FakeElement };
}

const isCheckbox = (el: FakeElement) => el.tagName === 'INPUT' && el.attrs.type === 'checkbox';

describe('SourceSwitcherModal', () => {
  it('renders one checked row per active source and focuses the first', () => {
    const { contentEl } = openSwitcher();
    const checkboxes = contentEl.queryAll(isCheckbox);
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(checkboxes[0]?.focused).toBe(true);
    expect(contentEl.query((el) => el.text === 'Recurring tasks')).not.toBeNull();
    expect(contentEl.query((el) => el.text === 'Time entries')).not.toBeNull();
  });

  it('a hidden source renders unchecked', () => {
    const state = createSourceSwitcherState();
    state.toggle('time-entry');
    const { contentEl } = openSwitcher(ACTIVE, state);
    const [recurring, timeEntry] = contentEl.queryAll(isCheckbox);
    expect(recurring?.checked).toBe(true);
    expect(timeEntry?.checked).toBe(false);
  });

  it('a checkbox change hides the source in the session state and re-renders unchecked', () => {
    const { contentEl, state } = openSwitcher();
    contentEl.queryAll(isCheckbox)[1]?.trigger('change');
    expect(state.isHidden('time-entry')).toBe(true);
    const rerendered = contentEl.queryAll(isCheckbox);
    expect(rerendered[1]?.checked).toBe(false);
    expect(rerendered[0]?.checked).toBe(true);
  });

  it('Enter toggles the row and keeps focus on it', () => {
    const { contentEl, state } = openSwitcher();
    contentEl.queryAll(isCheckbox)[1]?.trigger('keydown', { key: 'Enter' });
    expect(state.isHidden('time-entry')).toBe(true);
    const rerendered = contentEl.queryAll(isCheckbox);
    expect(rerendered[1]?.checked).toBe(false);
    expect(rerendered[1]?.focused).toBe(true);
  });

  it('Space is left to the native checkbox toggle (no keydown double-toggle)', () => {
    const { contentEl, state } = openSwitcher();
    contentEl.queryAll(isCheckbox)[0]?.trigger('keydown', { key: ' ' });
    expect(state.isHidden('recurring-instance')).toBe(false);
  });

  it('arrow keys move focus between rows', () => {
    const { contentEl } = openSwitcher();
    const checkboxes = contentEl.queryAll(isCheckbox);
    checkboxes[0]?.trigger('keydown', { key: 'ArrowDown' });
    expect(checkboxes[1]?.focused).toBe(true);
  });

  it('shows an empty notice when no source is active', () => {
    const { contentEl } = openSwitcher([]);
    expect(contentEl.queryAll(isCheckbox)).toHaveLength(0);
    expect(
      contentEl.query((el) => el.text === 'No calendar-item sources are active in this view.'),
    ).not.toBeNull();
  });
});
