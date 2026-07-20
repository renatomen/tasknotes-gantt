/**
 * The close-without-saving guard's modal, exercised against the obsidian mock's
 * recording Modal/FakeElement. The prototype-patch that opens it lives in
 * registerCalendarEditor; here we pin the choice each control resolves and that
 * a dismiss never loses work.
 */
import { describe, expect, it } from '@jest/globals';
import { App, FakeElement } from 'obsidian';
import { UnsavedCalendarModal } from '../../src/editor/UnsavedCalendarModal';

function open(canSave: boolean) {
  const modal = new UnsavedCalendarModal(new App(), canSave);
  const choice = modal.openAndGetChoice();
  return { modal, choice, contentEl: modal.contentEl as unknown as FakeElement };
}

const buttonWith = (contentEl: FakeElement, text: string): FakeElement | null =>
  contentEl.query((el) => el.tagName === 'BUTTON' && el.text === text);

describe('UnsavedCalendarModal', () => {
  it("resolves 'cancel' and focuses Go back so Enter keeps the edits", async () => {
    const { choice, contentEl } = open(true);
    const goBack = buttonWith(contentEl, 'Go back');
    expect(goBack?.focused).toBe(true);
    goBack?.trigger('click');
    expect(await choice).toBe('cancel');
  });

  it("resolves 'discard' when Discard is clicked", async () => {
    const { choice, contentEl } = open(true);
    buttonWith(contentEl, 'Discard')?.trigger('click');
    expect(await choice).toBe('discard');
  });

  it("resolves 'save' when Save is clicked and saving is possible", async () => {
    const { choice, contentEl } = open(true);
    const save = buttonWith(contentEl, 'Save');
    expect(save?.disabled).toBe(false);
    save?.trigger('click');
    expect(await choice).toBe('save');
  });

  it('disables Save when a save is not possible, and a click on it does not resolve save', async () => {
    const { choice, contentEl } = open(false);
    const save = buttonWith(contentEl, 'Save');
    expect(save?.disabled).toBe(true);
    // Even if a click reaches the disabled control, the handler must not save.
    save?.trigger('click');
    buttonWith(contentEl, 'Discard')?.trigger('click');
    expect(await choice).toBe('discard');
  });

  it("resolves 'cancel' on a dismiss so a reflex close never discards", async () => {
    const { modal, choice } = open(true);
    modal.close();
    expect(await choice).toBe('cancel');
  });
});
