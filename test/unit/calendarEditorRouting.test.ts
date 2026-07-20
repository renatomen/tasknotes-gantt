import { describe, expect, it } from '@jest/globals';
import {
  CALENDAR_EDITOR_VIEW_TYPE,
  createReentrancyGuard,
  displayNameFor,
  isPrimaryRoot,
  shouldHealToMarkdown,
  routeViewState,
  type RouteContext,
} from '../../src/editor/calendarEditorRouting';

const markerFor = (path: string): string | null =>
  path === 'Calendars/NZ.md' ? 'calendar' : path === 'Calendars/Team.md' ? 'calendar-set' : null;

const context = (over: Partial<RouteContext> = {}): RouteContext => ({
  isPrimaryLeaf: true,
  markerFor,
  ...over,
});

describe('routeViewState', () => {
  it('routes a primary-leaf markdown open of a marked note to the editor', () => {
    const routed = routeViewState({ type: 'markdown', state: { file: 'Calendars/NZ.md' } }, context());
    expect(routed?.type).toBe(CALENDAR_EDITOR_VIEW_TYPE);
    expect(routed?.state).toEqual(expect.objectContaining({ file: 'Calendars/NZ.md' }));
  });

  it('routes a calendar-set note the same way', () => {
    const routed = routeViewState({ type: 'markdown', state: { file: 'Calendars/Team.md' } }, context());
    expect(routed?.type).toBe(CALENDAR_EDITOR_VIEW_TYPE);
  });

  it('leaves an unmarked note as markdown', () => {
    expect(routeViewState({ type: 'markdown', state: { file: 'Notes/Plain.md' } }, context())).toBeNull();
  });

  it('leaves a non-primary leaf alone — hover previews, embeds and canvas stay markdown', () => {
    const state = { type: 'markdown', state: { file: 'Calendars/NZ.md' } };
    expect(routeViewState(state, context({ isPrimaryLeaf: false }))).toBeNull();
  });

  it('never re-routes a state that is already the editor', () => {
    const state = { type: CALENDAR_EDITOR_VIEW_TYPE, state: { file: 'Calendars/NZ.md' } };
    expect(routeViewState(state, context())).toBeNull();
  });

  it('leaves other view types untouched', () => {
    for (const type of ['bases', 'canvas', 'graph', 'image']) {
      expect(routeViewState({ type, state: { file: 'Calendars/NZ.md' } }, context())).toBeNull();
    }
  });

  it('ignores a state with no file to inspect', () => {
    expect(routeViewState({ type: 'markdown', state: {} }, context())).toBeNull();
    expect(routeViewState({ type: 'markdown' }, context())).toBeNull();
  });

  it('preserves the rest of the original state (active, mode, eState)', () => {
    const routed = routeViewState(
      { type: 'markdown', active: true, state: { file: 'Calendars/NZ.md', mode: 'source' } },
      context(),
    );
    expect(routed?.active).toBe(true);
    expect(routed?.state).toEqual(
      expect.objectContaining({ file: 'Calendars/NZ.md', mode: 'source' }),
    );
  });
});

describe('createReentrancyGuard', () => {
  it('runs the body once and reports re-entry while it is running', () => {
    const guard = createReentrancyGuard();
    const seen: string[] = [];

    guard.run(() => {
      seen.push('outer');
      // Routing calls setViewState again — the interceptor must not recurse.
      const inner = guard.run(() => seen.push('inner'));
      expect(inner).toBe(false);
    });

    expect(seen).toEqual(['outer']);
  });

  it('releases after the body so a later call routes again', () => {
    const guard = createReentrancyGuard();
    expect(guard.run(() => {})).toBe(true);
    expect(guard.run(() => {})).toBe(true);
  });

  it('releases even when the body throws, so one failure cannot wedge routing', () => {
    const guard = createReentrancyGuard();
    expect(() =>
      guard.run(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(guard.run(() => {})).toBe(true);
  });
});

describe('self-healing floor', () => {
  it('an editor-typed state whose note lost its marker heals back to markdown', () => {
    const healed = routeViewState(
      { type: CALENDAR_EDITOR_VIEW_TYPE, state: { file: 'Notes/Plain.md' } },
      context(),
      { heal: true },
    );
    expect(healed?.type).toBe('markdown');
  });

  it('an editor-typed state whose note still has its marker is left alone', () => {
    const healed = routeViewState(
      { type: CALENDAR_EDITOR_VIEW_TYPE, state: { file: 'Calendars/NZ.md' } },
      context(),
      { heal: true },
    );
    expect(healed).toBeNull();
  });
});

describe('isPrimaryRoot', () => {
  const rootSplit = { id: 'root' };
  const floatingSplit = { id: 'floating' };

  it('accepts the main workspace and a detached window', () => {
    expect(isPrimaryRoot(rootSplit, rootSplit, floatingSplit)).toBe(true);
    expect(isPrimaryRoot(floatingSplit, rootSplit, floatingSplit)).toBe(true);
  });

  it('rejects a popover root — hover previews stay markdown', () => {
    expect(isPrimaryRoot({ id: 'popover' }, rootSplit, floatingSplit)).toBe(false);
  });

  it('fails CLOSED for an unplaceable leaf, because markdown is the floor', () => {
    expect(isPrimaryRoot(undefined, rootSplit, floatingSplit)).toBe(false);
    expect(isPrimaryRoot(null, rootSplit, floatingSplit)).toBe(false);
  });
});

describe('displayNameFor', () => {
  it('uses the basename without the extension', () => {
    expect(displayNameFor('Calendars/NZ Holidays.md')).toBe('NZ Holidays');
    expect(displayNameFor('Top.md')).toBe('Top');
    expect(displayNameFor('Folder/No Extension')).toBe('No Extension');
  });

  it('falls back when there is no file yet', () => {
    expect(displayNameFor(null)).toBe('Calendar');
    expect(displayNameFor('')).toBe('Calendar');
  });
});

describe('shouldHealToMarkdown', () => {
  it('heals an open editor whose note lost its marker', () => {
    // The marker can vanish under an open view (hand edit, external sync) and
    // Obsidian does not re-invoke setState for that.
    expect(shouldHealToMarkdown('Calendars/NZ.md', false)).toBe(true);
  });

  it('leaves a still-marked note alone', () => {
    expect(shouldHealToMarkdown('Calendars/NZ.md', true)).toBe(false);
  });

  it('does nothing without a file', () => {
    expect(shouldHealToMarkdown(null, false)).toBe(false);
  });
});
