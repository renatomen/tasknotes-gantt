/**
 * The inferred-drag prompt modal, exercised against the obsidian mock's recording
 * Modal/Setting/FakeElement. Pins the choice each control resolves, that the
 * conservative action is the default-focused CTA (so Enter never reflexively
 * writes a date), that the "Don't ask again" toggle rides along, and that a
 * dismiss cancels without losing a prior choice.
 */
import { describe, expect, it } from '@jest/globals';
import { App, FakeElement } from 'obsidian';
import { InferredDragModal } from '../../src/bases/InferredDragModal';

function open() {
  const modal = new InferredDragModal(new App());
  const choice = modal.openAndGetChoice();
  return { modal, choice, contentEl: modal.contentEl as unknown as FakeElement };
}

const buttonWith = (contentEl: FakeElement, text: string): FakeElement | null =>
  contentEl.query((el) => el.tagName === 'BUTTON' && el.text === text);

const checkbox = (contentEl: FakeElement): FakeElement | null =>
  contentEl.query((el) => el.tagName === 'INPUT');

describe('InferredDragModal', () => {
  it('default-focuses "Estimate only" as the sole CTA so Enter grows the estimate', () => {
    const { contentEl } = open();
    const estimateOnly = buttonWith(contentEl, 'Estimate only');
    expect(estimateOnly?.focused).toBe(true);
    expect(estimateOnly?.cls).toContain('mod-cta');
    // "Estimate and dates" is a non-CTA secondary — Enter must not reach it.
    expect(buttonWith(contentEl, 'Estimate and dates')?.cls).not.toContain('mod-cta');
  });

  it('resolves estimate-only when "Estimate only" is clicked', async () => {
    const { choice, contentEl } = open();
    buttonWith(contentEl, 'Estimate only')?.trigger('click');
    expect(await choice).toEqual({ action: 'estimate-only', dontAskAgain: false });
  });

  it('resolves estimate-and-dates when "Estimate and dates" is clicked', async () => {
    const { choice, contentEl } = open();
    buttonWith(contentEl, 'Estimate and dates')?.trigger('click');
    expect(await choice).toEqual({ action: 'estimate-and-dates', dontAskAgain: false });
  });

  it('carries dontAskAgain when the toggle is ticked before choosing', async () => {
    const { choice, contentEl } = open();
    const toggle = checkbox(contentEl);
    if (toggle) toggle.checked = true;
    toggle?.trigger('change');
    buttonWith(contentEl, 'Estimate only')?.trigger('click');
    expect(await choice).toEqual({ action: 'estimate-only', dontAskAgain: true });
  });

  it('resolves null (cancel) on a dismiss so a reflex close writes nothing', async () => {
    const { modal, choice } = open();
    modal.close();
    expect(await choice).toBeNull();
  });

  it('settles once — a dismiss after a choice does not override the chosen action', async () => {
    const { modal, choice, contentEl } = open();
    buttonWith(contentEl, 'Estimate and dates')?.trigger('click');
    modal.close();
    expect(await choice).toEqual({ action: 'estimate-and-dates', dontAskAgain: false });
  });
});
