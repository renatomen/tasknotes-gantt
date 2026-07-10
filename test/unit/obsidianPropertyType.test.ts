/**
 * obsidianPropertyType unit tests (grid markdown cell rendering, U2).
 *
 * Verifies the metadataTypeManager widget accessor: reads the assigned widget,
 * is case-insensitive on the property name, prefers `widget` over `type`, and
 * degrades to null on any missing/malformed shape so the resolver can fall
 * through to the next type source.
 */

import { describe, it, expect } from '@jest/globals';
import type { App } from 'obsidian';
import { getObsidianPropertyWidget } from '../../src/bases/obsidianPropertyType';

function makeApp(properties: Record<string, { type?: string; widget?: string } | undefined>): App {
  return { metadataTypeManager: { properties } } as unknown as App;
}

describe('getObsidianPropertyWidget', () => {
  it('returns the widget for a known property', () => {
    const app = makeApp({ tags: { widget: 'tags' }, assignee: { widget: 'multitext' } });
    expect(getObsidianPropertyWidget(app, 'tags')).toBe('tags');
    expect(getObsidianPropertyWidget(app, 'assignee')).toBe('multitext');
  });

  it('looks up case-insensitively (manager registers names lowercase)', () => {
    const app = makeApp({ assignee: { widget: 'multitext' } });
    expect(getObsidianPropertyWidget(app, 'Assignee')).toBe('multitext');
  });

  it('prefers widget over the legacy type field', () => {
    const app = makeApp({ created: { type: 'date', widget: 'datetime' } });
    expect(getObsidianPropertyWidget(app, 'created')).toBe('datetime');
  });

  it('falls back to type when widget is absent', () => {
    const app = makeApp({ created: { type: 'date' } });
    expect(getObsidianPropertyWidget(app, 'created')).toBe('date');
  });

  it('returns null when the property is absent', () => {
    const app = makeApp({ tags: { widget: 'tags' } });
    expect(getObsidianPropertyWidget(app, 'nonexistent')).toBeNull();
  });

  it('returns null when metadataTypeManager is absent', () => {
    const app = {} as unknown as App;
    expect(getObsidianPropertyWidget(app, 'tags')).toBeNull();
  });

  it('returns null when properties map is absent', () => {
    const app = { metadataTypeManager: {} } as unknown as App;
    expect(getObsidianPropertyWidget(app, 'tags')).toBeNull();
  });

  it('returns null for a non-string / empty widget', () => {
    const app = makeApp({ a: { widget: '' }, b: { widget: undefined, type: undefined } });
    expect(getObsidianPropertyWidget(app, 'a')).toBeNull();
    expect(getObsidianPropertyWidget(app, 'b')).toBeNull();
  });
});
