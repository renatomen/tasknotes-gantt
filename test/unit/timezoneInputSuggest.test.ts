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

/** A suggestion-item stand-in recording the spans and styles render applies. */
function fakeEl() {
  const spans: Array<{ text?: string; style: Record<string, string> }> = [];
  const el = {
    style: {} as Record<string, string>,
    createSpan(options?: { text?: string }) {
      const span = { text: options?.text, style: {} as Record<string, string> };
      spans.push(span);
      return span;
    },
  };
  return { el, spans };
}

/** Reach the protected/overridden methods without widening the class surface. */
function asHarness(suggest: TimezoneInputSuggest) {
  return suggest as unknown as {
    getSuggestions(query: string): string[];
    renderSuggestion(zone: string, el: unknown): void;
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

  it('renders a suggestion as the zone with its current UTC offset', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    const { el, spans } = fakeEl();
    suggest.renderSuggestion('Europe/London', el);
    expect(spans[0]?.text).toBe('Europe/London');
    expect(spans[1]?.text).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });

  it('fills the input and notifies on pick', () => {
    const input = fakeInput();
    const suggest = asHarness(new TimezoneInputSuggest(app, input as never));
    suggest.selectSuggestion('Europe/London');
    expect(input.value).toBe('Europe/London');
    expect(input.dispatchEvent).toHaveBeenCalled();
  });
});
