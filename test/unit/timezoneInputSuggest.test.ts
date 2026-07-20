/* global Event */
import { describe, expect, it, jest } from '@jest/globals';
import type { App } from 'obsidian';
import { TimezoneInputSuggest } from '../../src/bases/timezoneInputSuggest';

/** A minimal input stand-in — the suggester only sets value, dispatches, focuses. */
function fakeInput() {
  return {
    value: '',
    dispatchEvent: jest.fn<(event: Event) => boolean>(() => true),
    focus: jest.fn(),
  };
}

/** Reach the protected/overridden methods without widening the class surface. */
function asHarness(suggest: TimezoneInputSuggest) {
  return suggest as unknown as {
    getSuggestions(query: string): string[];
    renderSuggestion(zone: string, el: { setText(t: string): void }): void;
    selectSuggestion(zone: string): void;
  };
}

describe('TimezoneInputSuggest', () => {
  const app = {} as App;

  it('suggests real IANA zones matching the query', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    expect(suggest.getSuggestions('Auckland')).toContain('Pacific/Auckland');
  });

  it('always offers UTC even though supportedValuesOf omits it', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    expect(suggest.getSuggestions('UTC')).toContain('UTC');
  });

  it('renders a suggestion as its plain zone name', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    const el = { setText: jest.fn() };
    suggest.renderSuggestion('Europe/London', el);
    expect(el.setText).toHaveBeenCalledWith('Europe/London');
  });

  it('fills the input and notifies on pick', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    suggest.selectSuggestion('Europe/London');
    expect(input.value).toBe('Europe/London');
    expect(input.dispatchEvent).toHaveBeenCalled();
  });
});
