/**
 * U8 — the retained incomplete-date-parent heads-up notice (#161/R8).
 *
 * The notice appears ONLY when a date filter is OFF and a matching parent is kept
 * visible because it has a dated (visible) descendant; otherwise nothing. Both
 * date-incompleteness classes are covered: undated (`placeholder`, gated on
 * Show-undated) and partial-date (`inferred-*`, gated on Show-partial).
 */

import {
  buildRetainedAncestorNotice,
  type RetainedNoticeInstance,
} from '../../src/bases/retainedAncestorNotice';
import type { RowVisibilityFlags } from '../../src/bases/rowVisibility';
import type { DateStatus } from '../../src/controller/datePolicy';

const SHOW_ALL: RowVisibilityFlags = {
  hideTopLevel: false,
  showUndated: true,
  showPartial: true,
};
const HIDE_UNDATED: RowVisibilityFlags = { ...SHOW_ALL, showUndated: false };
const HIDE_PARTIAL: RowVisibilityFlags = { ...SHOW_ALL, showPartial: false };

function node(id: string, dateStatus: DateStatus, parent?: string): RetainedNoticeInstance {
  return { id, dateStatus, parent, isTopLevelPlacement: false };
}

describe('buildRetainedAncestorNotice', () => {
  it('returns undefined when both date filters are ON (notice is irrelevant)', () => {
    const tree = [node('p', 'placeholder'), node('c', 'complete', 'p')];
    expect(buildRetainedAncestorNotice(tree, SHOW_ALL)).toBeUndefined();
  });

  it('reports an undated parent kept visible by its dated child', () => {
    const tree = [node('p', 'placeholder'), node('c', 'complete', 'p')];
    expect(buildRetainedAncestorNotice(tree, HIDE_UNDATED)).toBe(
      '1 undated parent kept to show their dated subtasks.',
    );
  });

  it('reports a partial-date parent kept visible by its dated child', () => {
    const tree = [node('p', 'inferred-start'), node('c', 'complete', 'p')];
    expect(buildRetainedAncestorNotice(tree, HIDE_PARTIAL)).toBe(
      '1 partial-date parent kept to show their dated subtasks.',
    );
  });

  it('combines both classes when both date filters are OFF', () => {
    const tree = [
      node('pu', 'placeholder'),
      node('cu', 'complete', 'pu'),
      node('pp', 'inferred-end'),
      node('cp', 'complete', 'pp'),
    ];
    expect(
      buildRetainedAncestorNotice(tree, { ...SHOW_ALL, showUndated: false, showPartial: false }),
    ).toBe('1 undated parent and 1 partial-date parent kept to show their dated subtasks.');
  });

  it('pluralizes the count across multiple retained undated parents', () => {
    const tree = [
      node('p1', 'placeholder'),
      node('c1', 'complete', 'p1'),
      node('p2', 'placeholder'),
      node('c2', 'inferred-start', 'p2'), // a partial child still passes under HIDE_UNDATED
    ];
    expect(buildRetainedAncestorNotice(tree, HIDE_UNDATED)).toBe(
      '2 undated parents kept to show their dated subtasks.',
    );
  });

  it('returns undefined for an undated LEAF (no descendant keeps it — it is simply hidden)', () => {
    const tree = [node('p', 'complete'), node('leaf', 'placeholder', 'p')];
    expect(buildRetainedAncestorNotice(tree, HIDE_UNDATED)).toBeUndefined();
  });

  it('returns undefined when an undated parent has only undated children (all hidden)', () => {
    const tree = [node('p', 'placeholder'), node('c', 'placeholder', 'p')];
    expect(buildRetainedAncestorNotice(tree, HIDE_UNDATED)).toBeUndefined();
  });

  it('does not count an undated parent when only Show-partial is OFF (its rule is inactive)', () => {
    const tree = [node('p', 'placeholder'), node('c', 'complete', 'p')];
    expect(buildRetainedAncestorNotice(tree, HIDE_PARTIAL)).toBeUndefined();
  });

  it('counts a parent retained via a deeper (grandchild) visible descendant', () => {
    const tree = [
      node('p', 'placeholder'),
      node('mid', 'placeholder', 'p'),
      node('leaf', 'complete', 'mid'),
    ];
    // Both p and mid are undated parents kept alive by the dated leaf.
    expect(buildRetainedAncestorNotice(tree, HIDE_UNDATED)).toBe(
      '2 undated parents kept to show their dated subtasks.',
    );
  });
});
