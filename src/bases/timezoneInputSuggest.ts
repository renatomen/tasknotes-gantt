/* global HTMLInputElement, Event */
/**
 * A searchable IANA-timezone picker over a plain text input: an
 * `AbstractInputSuggest` that filters the runtime's supported zones as the user
 * types, so a timezone is chosen from the valid set rather than typed blind.
 * Mirrors {@link WikilinkInputSuggest} — the caller constructs it after mount
 * and disposes it when the input leaves.
 *
 * @module bases/timezoneInputSuggest
 */

import { AbstractInputSuggest, type App } from 'obsidian';
import { filterTimezones } from '../editor/timezoneFilter';
import { formatUtcOffset } from '../editor/timezoneOffset';

export class TimezoneInputSuggest extends AbstractInputSuggest<string> {
  private readonly inputEl: HTMLInputElement;
  private readonly zones: string[];

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.zones = supportedTimezones();
  }

  protected getSuggestions(query: string): string[] {
    return filterTimezones(this.zones, query);
  }

  renderSuggestion(zone: string, el: HTMLElement): void {
    // Zone on the left, its current UTC offset muted on the right — a live,
    // DST-aware hint so similar zone names are easy to tell apart.
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.gap = '1rem';
    el.createSpan({ text: zone });
    const offset = formatUtcOffset(zone);
    if (offset !== null) {
      const offsetEl = el.createSpan({ text: offset });
      offsetEl.style.color = 'var(--text-muted)';
    }
  }

  selectSuggestion(zone: string): void {
    this.inputEl.value = zone;
    // Bubbling `input` keeps the form's bound value in sync; then dismiss.
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.inputEl.focus();
    this.close();
  }
}

/**
 * The runtime's IANA zones, with `UTC` guaranteed present — `supportedValuesOf`
 * omits it in some runtimes, yet it is the one zone users most expect to pick.
 */
function supportedTimezones(): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof supported === 'function') zones = supported('timeZone');
  } catch {
    zones = [];
  }
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}
