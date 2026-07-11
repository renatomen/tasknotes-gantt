/* global HTMLInputElement, Event */
/**
 * Turns a plain text `<input>` into an Obsidian-native `[[` link suggester: an
 * `AbstractInputSuggest` that reads the live caret, detects an open `[[…` token,
 * serves filtered vault notes through the injected fetcher, and — on pick —
 * splices the full `[[Note]]` at the caret rather than replacing the whole
 * field. This is the shared primitive the single-value and chips cell editors
 * host over their rendered input.
 *
 * Fire-and-forget, like TaskNotes' own input suggests: it captures only the
 * app, the input element, and the fetcher, so it is garbage-collected together
 * with the input when that leaves the DOM. The caller constructs it after mount
 * and never disposes it explicitly.
 *
 * @module bases/wikilinkInputSuggest
 */

import type { App } from 'obsidian';
import { AbstractInputSuggest, renderResults } from 'obsidian';
import { detectWikilinkToken, spliceWikilink } from './wikilinkToken';
import { wikilinkEntry, type SuggestionFetcher, type TaskNotesSuggestion } from './taskNotesSuggest';

export class WikilinkInputSuggest extends AbstractInputSuggest<TaskNotesSuggestion> {
  private readonly inputEl: HTMLInputElement;
  private readonly fetch: SuggestionFetcher;
  /** Value bounds the last-detected token occupies, cleared once a pick splices over them. */
  private tokenBounds: { start: number; end: number } | null = null;

  constructor(app: App, inputEl: HTMLInputElement, fetch: SuggestionFetcher) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.fetch = fetch;
    const reopen = (): void => this.reopenWhenTokenOpen();
    inputEl.addEventListener('focus', reopen);
    inputEl.addEventListener('click', reopen);
  }

  protected async getSuggestions(_query: string): Promise<TaskNotesSuggestion[]> {
    const token = this.detectTokenAtCaret();
    if (!token) {
      this.tokenBounds = null;
      return [];
    }
    this.tokenBounds = { start: token.start, end: token.end };
    return this.fetch(token.query);
  }

  renderSuggestion(item: TaskNotesSuggestion, el: HTMLElement): void {
    if (item.match) {
      renderResults(el, item.display, item.match);
    } else {
      el.setText(item.display);
    }
  }

  selectSuggestion(item: TaskNotesSuggestion): void {
    const bounds = this.tokenBounds;
    if (!bounds) return;
    const spliced = spliceWikilink(this.inputEl.value, bounds, wikilinkEntry(item.value));
    this.inputEl.value = spliced.value;
    this.inputEl.setSelectionRange(spliced.caret, spliced.caret);
    // Bubbling `input` keeps a host editor's bound value in sync; the base
    // handles popover teardown on select, so neither super nor close() runs.
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.inputEl.focus();
    this.tokenBounds = null;
  }

  private detectTokenAtCaret(): ReturnType<typeof detectWikilinkToken> {
    const value = this.inputEl.value;
    const caret = this.inputEl.selectionStart ?? value.length;
    return detectWikilinkToken(value, caret);
  }

  private reopenWhenTokenOpen(): void {
    if (this.detectTokenAtCaret()) this.open();
  }
}
