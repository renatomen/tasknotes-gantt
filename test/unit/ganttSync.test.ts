/**
 * ganttSync unit tests (Bug B — preserve zoom/scroll via targeted SVAR updates).
 *
 * Pure transform + diff layer driving `api.exec("update/add/move/delete-task")`
 * instead of replacing SVAR's tasks array (which re-inits the store and resets
 * the view). Covers:
 * - buildSvarTasks: parent→summary/open, leaf type composition (date-status flag
 *   + status-color class), custom metadata (showHasDeps by arrow mode).
 * - buildTreatmentTaskTypes: stable palette-derived superset (flag, treatment class, composed).
 * - planTaskSync: change detection, parent-first adds, leaf-first deletes, moves.
 * - planLinkSync: add/delete by id.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildSvarTasks,
  buildTreatmentTaskTypes,
  echoTaskPatch,
  crossGroupClassPairs,
  planTaskSync,
  planLinkSync,
  planReorder,
  baseSortDescriptor,
  taskStateKey,
  shouldBulkReseed,
  structuralOpCount,
  BULK_RESEED_OP_THRESHOLD,
  DATE_STATUS_TYPE,
  buildInstanceCueTaskTypes,
  REPLICATED_TYPE,
  CONTEXT_TYPE,
  EVENT_TYPE,
  type SvarTask,
  type SvarTaskInputs,
  type TaskSyncPlan,
  type LinkSyncPlan,
} from '../../src/bases/ganttSync';
import { statusSlug, prioritySlug, calendarSlug, PARENT_ROLE_CLASS } from '../../src/bases/barTreatment';
import {
  DATE_STATUS_STATE_CLASS_TOKENS,
  GANTT_VISUAL_CLASS_TOKENS,
  hasNonAuthoredEdgeInstance,
  isNonAuthoredEdgeToken,
  resolveDateStatusStateToken,
} from '../../src/bases/visualSemantics';
import { hasDerivedBarGeometry } from '../../src/bases/eventRowGuards';
import { makeCalendarItemId, type CalendarOccupancy } from '../../src/datasource/calendarItems';
import type { RenderInstance, RenderLink } from '../../src/controller/InstanceExpansion';
import type { PriorityColor, StatusColor } from '../../src/datasource/types';
import type { TypedValue } from '../../src/bases/propertyValues';
import type { CellRender } from '../../src/bases/cellRender';
import type { IncomingDep } from '../../src/bases/dependencyTooltip';
import type { IconSpec } from '../../src/bases/barTreatment';
import type { OccupancyRunSpan } from '../../src/render/segmentLayout';

/** Minimal RenderInstance factory with sane defaults. */
function inst(over: Partial<RenderInstance> & { id: string }): RenderInstance {
  return {
    id: over.id,
    sourcePath: over.sourcePath ?? `${over.id}.md`,
    text: over.text ?? over.id,
    start: over.start ?? new Date(2026, 0, 1),
    end: over.end ?? new Date(2026, 0, 2),
    progress: over.progress ?? 0,
    parent: over.parent,
    isVirtual: over.isVirtual ?? false,
    isCollapsed: over.isCollapsed ?? false,
    dateStatus: over.dateStatus ?? 'complete',
    estimateMinutes: over.estimateMinutes ?? null,
    status: over.status ?? null,
    priority: over.priority ?? null,
    isFetched: over.isFetched ?? false,
    isTopLevelPlacement: over.isTopLevelPlacement ?? false,
    ghostRuns: over.ghostRuns,
    stretchFlagged: over.stretchFlagged,
    interpretationOverridden: over.interpretationOverridden,
    calendarItem: over.calendarItem,
    occupancy: over.occupancy,
    plainBarSuppressed: over.plainBarSuppressed,
  };
}

function inputs(over: Partial<SvarTaskInputs>): SvarTaskInputs {
  return {
    instances: over.instances ?? [],
    links: over.links ?? [],
    statusColors: over.statusColors ?? [],
    priorityColors: over.priorityColors,
    // Default fill to the status source so the pre-existing status-class assertions
    // (which pass statusColors without a source) keep their meaning; the new
    // per-channel tests below override these explicitly.
    barFillSource: over.barFillSource ?? 'status',
    barStripSource: over.barStripSource ?? 'none',
    barIconSource: over.barIconSource,
    showDateIndicators: over.showDateIndicators ?? true,
    arrowMode: over.arrowMode ?? 'primary',
    hideTopLevelSubtasks: over.hideTopLevelSubtasks ?? false,
    propertyValues: over.propertyValues,
    collapsedIds: over.collapsedIds,
    managedPaths: over.managedPaths,
  };
}

function mapOf(tasks: SvarTask[]): Map<string, SvarTask> {
  return new Map(tasks.map((t) => [t.id, t]));
}

const ZIGZAG_START = GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagStart;
const ZIGZAG_END = GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagEnd;
const ZIGZAG_BOTH = GANTT_VISUAL_CLASS_TOKENS.dateStatusZigzagBoth;
const SWAPPED = GANTT_VISUAL_CLASS_TOKENS.dateStatusSwapped;
const DATE_STATUS_STATE_TOKENS = Object.values(DATE_STATUS_STATE_CLASS_TOKENS);

describe('resolveDateStatusStateToken', () => {
  it('maps each non-complete date status to its per-state token, and complete to none', () => {
    expect(resolveDateStatusStateToken('inferred-start')).toBe(ZIGZAG_START);
    expect(resolveDateStatusStateToken('inferred-end')).toBe(ZIGZAG_END);
    expect(resolveDateStatusStateToken('placeholder')).toBe(ZIGZAG_BOTH);
    expect(resolveDateStatusStateToken('swapped')).toBe(SWAPPED);
    expect(resolveDateStatusStateToken('complete')).toBeNull();
  });
});

describe('isNonAuthoredEdgeToken', () => {
  it('accepts the three torn-edge tokens and rejects swapped, absent and unknown ones', () => {
    expect(isNonAuthoredEdgeToken(ZIGZAG_START)).toBe(true);
    expect(isNonAuthoredEdgeToken(ZIGZAG_END)).toBe(true);
    expect(isNonAuthoredEdgeToken(ZIGZAG_BOTH)).toBe(true);
    expect(isNonAuthoredEdgeToken(SWAPPED)).toBe(false);
    expect(isNonAuthoredEdgeToken(GANTT_VISUAL_CLASS_TOKENS.dateStatus)).toBe(false);
    expect(isNonAuthoredEdgeToken(undefined)).toBe(false);
  });
});

describe('hasNonAuthoredEdgeInstance', () => {
  it('finds a torn-capable status among any mix and stays blind to row filters', () => {
    expect(hasNonAuthoredEdgeInstance(['complete', 'inferred-start'])).toBe(true);
    expect(hasNonAuthoredEdgeInstance(['inferred-end'])).toBe(true);
    expect(hasNonAuthoredEdgeInstance(['placeholder'])).toBe(true);
    expect(hasNonAuthoredEdgeInstance(['complete', 'swapped'])).toBe(false);
    expect(hasNonAuthoredEdgeInstance([])).toBe(false);
  });
});

describe('buildSvarTasks', () => {
  it('renders a parent as an ordinary task at its own dates (not a summary) but keeps it open', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 5);
    const tasks = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p', start, end }), inst({ id: 'c', parent: 'p' })] }),
    );
    const parent = tasks.find((t) => t.id === 'p')!;
    const child = tasks.find((t) => t.id === 'c')!;
    // Not a summary — shows its own dates, fully draggable, clean date-writes.
    expect(parent.type).not.toBe('summary');
    expect(parent.start).toEqual(start);
    expect(parent.end).toEqual(end);
    expect(parent.open).toBe(true);
    expect(child.parent).toBe('p');
  });

  it('seeds a parent open by default but closed when in collapsedIds (U7)', () => {
    const instances = [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' })];
    const open = buildSvarTasks(inputs({ instances }));
    expect(open.find((t) => t.id === 'p')!.open).toBe(true);
    const closed = buildSvarTasks(inputs({ instances, collapsedIds: new Set(['p']) }));
    expect(closed.find((t) => t.id === 'p')!.open).toBe(false);
  });

  it('applies the status-color class to a parent (parents are ordinary bars)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p', status: 'wip' }), inst({ id: 'c', parent: 'p' })],
        statusColors: colors,
      }),
    );
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(statusSlug('wip'));
  });

  it('flags a swapped leaf with the date-status type only', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus: 'swapped' })] }));
    expect(t.type).toBe(DATE_STATUS_TYPE);
  });

  it('does not flag when date indicators are off', () => {
    const [t] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'swapped' })], showDateIndicators: false }),
    );
    expect(t.type).toBe('task');
  });

  it('publishes the per-state date-status token on custom for each non-complete status', () => {
    const tokenOf = (dateStatus: RenderInstance['dateStatus']) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus })] }))[0]!.custom
        .dateStatusToken;
    expect(tokenOf('inferred-start')).toBe(ZIGZAG_START);
    expect(tokenOf('inferred-end')).toBe(ZIGZAG_END);
    expect(tokenOf('placeholder')).toBe(ZIGZAG_BOTH);
    expect(tokenOf('swapped')).toBe(SWAPPED);
    expect(tokenOf('complete')).toBeUndefined();
  });

  it('publishes no per-state date-status token when date indicators are off', () => {
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', dateStatus: 'placeholder' })],
        showDateIndicators: false,
      }),
    );
    expect(t.custom.dateStatusToken).toBeUndefined();
  });

  it('keeps the per-state token OUT of the composed bar type (one flag id, not a per-state one)', () => {
    // The token rides per-instance `custom`, never `type`: folding it into the
    // whole-string type would multiply the pre-registered cross-product SVAR
    // linear-scans per bar.
    const typeOf = (dateStatus: RenderInstance['dateStatus']) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus })] }))[0]!.type;
    for (const dateStatus of ['inferred-start', 'inferred-end', 'placeholder'] as const) {
      expect(typeOf(dateStatus)).toBe('task');
    }
    expect(typeOf('swapped')).toBe(DATE_STATUS_TYPE);
    expect(typeOf('complete')).toBe('task');
  });

  it('leaves a non-authored-edge leaf unflagged — the torn edge is its whole signal', () => {
    // The colour treatment the flag drives is retired for these three states:
    // they say "this edge was not authored" with their own shape, so a bar that
    // still carried the flag would repaint over the fill the zigzag composes with.
    for (const dateStatus of ['inferred-start', 'inferred-end', 'placeholder'] as const) {
      const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus })] }));
      expect(t.type).toBe('task');
      // …while the per-state token that DOES signal them still rides `custom`.
      expect(t.custom.dateStatusToken).toBe(DATE_STATUS_STATE_CLASS_TOKENS[dateStatus]);
    }
  });

  it('taskStateKey changes when only the per-state date-status token changes (re-sync guard)', () => {
    const keyFor = (dateStatus: RenderInstance['dateStatus']) =>
      taskStateKey(buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus })] }))[0]!);
    // These pairs compose an IDENTICAL `type` — the three non-authored-edge
    // states are all plain `task` — so without the fold the diff-sync would skip
    // the update and the bar would keep the previous state's cue.
    expect(keyFor('inferred-start')).not.toBe(keyFor('inferred-end'));
    expect(keyFor('placeholder')).not.toBe(keyFor('inferred-start'));
    expect(keyFor('swapped')).toBe(keyFor('swapped'));
  });

  it('plans an update-task when only the per-state date-status token changes (live re-stamp)', () => {
    const build = (dateStatus: RenderInstance['dateStatus']) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus })] }));
    const before = build('inferred-start');
    const after = build('inferred-end');
    // Same dates, same treatment classes, same cues — and an IDENTICAL composed
    // `type` (a non-authored edge composes no state class at all), so the
    // fingerprint fold is the only thing that can carry the re-stamp to the bar.
    expect(before[0]!.type).toBe(after[0]!.type);
    const plan = planTaskSync(mapOf(before), after);
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.updates[0]!.task.custom.dateStatusToken).toBe(ZIGZAG_END);
    expect(plan.adds).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('plans an update-task when the indicator toggle drops the per-state token', () => {
    const build = (showDateIndicators: boolean) =>
      buildSvarTasks(
        inputs({ instances: [inst({ id: 'a', dateStatus: 'placeholder' })], showDateIndicators }),
      );
    const plan = planTaskSync(mapOf(build(true)), build(false));
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.updates[0]!.task.custom.dateStatusToken).toBeUndefined();
  });

  it('composes the date-status flag with the status-color class (flag first)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', dateStatus: 'swapped', status: 'wip' })],
        statusColors: colors,
      }),
    );
    expect(t.type).toBe(`${DATE_STATUS_TYPE} ${statusSlug('wip')}`);
  });

  it('omits a status class when the status has no configured color', () => {
    const [t] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'unmapped' })], statusColors: [] }),
    );
    expect(t.type).toBe('task');
  });

  it('applies the priority slug for source=priority', () => {
    const priorityColors: PriorityColor[] = [{ value: 'high', color: '#f00' }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', priority: 'high' })],
        barFillSource: 'priority',
        priorityColors,
      }),
    );
    expect(t.type).toBe(prioritySlug('high'));
  });

  it('carries BOTH the fill and strip classes for a two-channel view (fill=status, strip=priority)', () => {
    const statusColors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const priorityColors: PriorityColor[] = [{ value: 'high', color: '#f00' }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', status: 'wip', priority: 'high' })],
        barFillSource: 'status',
        barStripSource: 'priority',
        statusColors,
        priorityColors,
      }),
    );
    // Fill class first, then strip class — the resolveTreatmentClass order.
    expect(t.type).toBe(`${statusSlug('wip')} ${prioritySlug('high')}`);
  });

  it('carries a single class for a redundant same-source two-channel view (fill=status, strip=status)', () => {
    const statusColors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', status: 'wip' })],
        barFillSource: 'status',
        barStripSource: 'status',
        statusColors,
      }),
    );
    expect(t.type).toBe(statusSlug('wip'));
  });

  it('applies og-parent to a parent (not a child) for source=theme', () => {
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' })],
        barFillSource: 'theme',
      }),
    );
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(PARENT_ROLE_CLASS);
    expect(tasks.find((t) => t.id === 'c')!.type).not.toContain(PARENT_ROLE_CLASS);
  });

  it('source=default applies og-parent to a parent, nothing to a leaf (role coloring)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p', status: 'wip' }), inst({ id: 'c', parent: 'p' })],
        statusColors: colors,
        barFillSource: 'default',
      }),
    );
    // Role coloring keys off hierarchy, not the status palette.
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(PARENT_ROLE_CLASS);
    expect(tasks.find((t) => t.id === 'c')!.type).toBe('task');
  });

  it('attaches custom.barIcon from the icon source, null when none', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false, icon: 'circle' }];
    const withIcon = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource: 'status' }),
    )[0];
    expect(withIcon.custom.barIcon).toEqual({ kind: 'status', iconName: 'circle', color: '#abc' });

    const noIcon = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource: 'none' }),
    )[0];
    expect(noIcon.custom.barIcon).toBeNull();
  });

  it('taskStateKey changes when the icon source toggles (re-sync guard)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false, icon: 'circle' }];
    const keyOf = (barIconSource: 'none' | 'status') =>
      taskStateKey(
        buildSvarTasks(inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource }))[0],
      );
    expect(keyOf('none')).not.toBe(keyOf('status'));
  });

  it('taskStateKey changes when the icon kind flips with same color + no glyph (ring vs dot)', () => {
    // A status ring and a priority dot that share a color and have NO glyph differ
    // ONLY by kind; the fingerprint must still change so the toggle re-syncs.
    const statusColors: StatusColor[] = [{ value: 'v', color: '#abc', isCompleted: false }];
    const priorityColors: PriorityColor[] = [{ value: 'v', color: '#abc' }];
    const instance = inst({ id: 'a', status: 'v', priority: 'v' });
    const keyFor = (barIconSource: 'status' | 'priority') =>
      taskStateKey(
        buildSvarTasks(inputs({ instances: [instance], statusColors, priorityColors, barIconSource }))[0],
      );
    expect(keyFor('status')).not.toBe(keyFor('priority'));
  });

  it('taskStateKey changes when a no-icon status flips completed (ring vs filled disc)', () => {
    // A completed and a non-completed no-icon status share value + color and differ
    // ONLY by the completed flag (ring vs filled disc); the fingerprint must change
    // so the completion transition re-syncs the chip.
    const keyFor = (isCompleted: boolean) =>
      taskStateKey(
        buildSvarTasks(
          inputs({
            instances: [inst({ id: 'a', status: 'v' })],
            statusColors: [{ value: 'v', color: '#abc', isCompleted }],
            barIconSource: 'status',
          }),
        )[0],
      );
    expect(keyFor(false)).not.toBe(keyFor(true));
  });

  it('carries dateStatus onto custom for the view filter predicate (U2)', () => {
    // The presentation-layer show-undated/show-partial filter reads custom.dateStatus
    // to decide row visibility (#161), so it must ride each instance onto the task.
    const [placeholder] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'placeholder' })] }),
    );
    expect(placeholder.custom.dateStatus).toBe('placeholder');
    const [partial] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'b', dateStatus: 'inferred-start' })] }),
    );
    expect(partial.custom.dateStatus).toBe('inferred-start');
  });

  it('sets showHasDeps only for a non-primary linked instance in primary mode', () => {
    // Two instances of the same source path c.md; the first is primary.
    const instances = [
      inst({ id: 'c#1', sourcePath: 'c.md' }),
      inst({ id: 'c#2', sourcePath: 'c.md' }),
      inst({ id: 'd', sourcePath: 'd.md' }),
    ];
    const links: RenderLink[] = [{ id: 'L1', source: 'c#1', target: 'd', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const tasks = buildSvarTasks(inputs({ instances, links, arrowMode: 'primary' }));
    expect(tasks.find((t) => t.id === 'c#1')!.custom.showHasDeps).toBe(false); // primary
    expect(tasks.find((t) => t.id === 'c#2')!.custom.showHasDeps).toBe(true); // non-primary, has deps
  });

  it('never sets showHasDeps in "all" arrow mode', () => {
    const instances = [inst({ id: 'c#1', sourcePath: 'c.md' }), inst({ id: 'c#2', sourcePath: 'c.md' })];
    const links: RenderLink[] = [{ id: 'L1', source: 'c#1', target: 'c#2', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const tasks = buildSvarTasks(inputs({ instances, links, arrowMode: 'all' }));
    expect(tasks.every((t) => t.custom.showHasDeps === false)).toBe(true);
  });

  it('attaches incoming dependency edges to the target task with the predecessor named and identified', () => {
    const instances = [
      inst({ id: 'pred', sourcePath: 'pred.md', text: 'Draft docs' }),
      inst({ id: 'dep', sourcePath: 'dep.md', text: 'Review docs' }),
    ];
    const links: RenderLink[] = [
      { id: 'L1', source: 'pred', target: 'dep', type: 's2s', reltype: 'STARTTOSTART', gap: 'P1D' },
    ];
    const tasks = buildSvarTasks(inputs({ instances, links }));
    expect(tasks.find((t) => t.id === 'dep')!.custom.incomingDeps).toEqual([
      { reltype: 'STARTTOSTART', gap: 'P1D', predecessorName: 'Draft docs', linkId: 'L1' },
    ]);
    // The predecessor (source) task has no incoming edges.
    expect(tasks.find((t) => t.id === 'pred')!.custom.incomingDeps).toEqual([]);
  });

  it('taskStateKey changes when only an incoming dependency gap changes (re-sync guard)', () => {
    const instances = [
      inst({ id: 'pred', text: 'P' }),
      inst({ id: 'dep' }),
    ];
    const linkOf = (gap: string | null): RenderLink => ({
      id: `pred->dep:e2s:${gap ?? ''}`,
      source: 'pred',
      target: 'dep',
      type: 'e2s',
      reltype: 'FINISHTOSTART',
      gap,
    });
    const keyOf = (gap: string | null): string => {
      const dep = buildSvarTasks(inputs({ instances, links: [linkOf(gap)] })).find((t) => t.id === 'dep')!;
      return taskStateKey(dep);
    };
    expect(keyOf(null)).not.toBe(keyOf('P1D'));
  });

  it('taskStateKey changes when an edge keeps its wording but moves to a new id', () => {
    const keyOf = (predecessorId: string): string => {
      const instances = [inst({ id: predecessorId, text: 'Draft docs' }), inst({ id: 'dep' })];
      const links: RenderLink[] = [
        {
          id: `${predecessorId}->dep:e2s:`,
          source: predecessorId,
          target: 'dep',
          type: 'e2s',
          reltype: 'FINISHTOSTART',
          gap: null,
        },
      ];
      return taskStateKey(buildSvarTasks(inputs({ instances, links })).find((t) => t.id === 'dep')!);
    };
    // Reparenting a predecessor rebuilds its instance id, and the edge id with
    // it, while the name, relationship and gap all read the same. The blocked
    // row must still re-issue, or it keeps an edge id no drawn arrow carries.
    expect(keyOf('pred#a')).not.toBe(keyOf('pred#b'));
  });
});

describe('buildTreatmentTaskTypes', () => {
  const palettes = {
    status: [{ value: 'wip', color: '#abc', isCompleted: false }] as StatusColor[],
    priority: [{ value: 'high', color: '#f00' }] as PriorityColor[],
  };

  it('registers date-status, og-parent, and status+priority slugs (alone and composed)', () => {
    const ids = buildTreatmentTaskTypes(palettes).map((t) => t.id);
    expect(ids).toContain(DATE_STATUS_TYPE);
    expect(ids).toContain(PARENT_ROLE_CLASS);
    expect(ids).toContain(statusSlug('wip'));
    expect(ids).toContain(prioritySlug('high'));
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${prioritySlug('high')}`);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${PARENT_ROLE_CLASS}`);
  });

  it('registers no per-state date-status token, so the cross-product stays at its flag-only size', () => {
    const baseIds = buildTreatmentTaskTypes(palettes).map((t) => t.id);
    const cueIds = buildInstanceCueTaskTypes(baseIds).map((t) => t.id);
    for (const id of [...baseIds, ...cueIds]) {
      for (const token of DATE_STATUS_STATE_TOKENS) expect(id).not.toContain(token);
    }
    // The flag itself still registers — the dark-launch hook is unchanged.
    expect(baseIds).toContain(DATE_STATUS_TYPE);
  });

  it('registers the ordered two-class pairs a two-channel bar can compose (fill class + strip class)', () => {
    const ids = buildTreatmentTaskTypes(palettes).map((t) => t.id);
    // A fill=status + strip=priority bar composes `<status> <priority>`; the whole
    // string must be a registered id or SVAR drops it back to the plain `task` type.
    expect(ids).toContain(`${statusSlug('wip')} ${prioritySlug('high')}`);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${statusSlug('wip')} ${prioritySlug('high')}`);
    // Both orderings exist (either class can be fill or strip)...
    expect(ids).toContain(`${prioritySlug('high')} ${statusSlug('wip')}`);
    // ...but never a class paired with itself (a redundant combo dedupes to one class).
    expect(ids).not.toContain(`${statusSlug('wip')} ${statusSlug('wip')}`);
  });

  it('registers ids in a stable order (the registration order is a downstream contract)', () => {
    const ids = buildTreatmentTaskTypes(palettes).map((t) => t.id);
    const s = statusSlug('wip');
    const p = prioritySlug('high');
    expect(ids).toEqual([
      DATE_STATUS_TYPE,
      PARENT_ROLE_CLASS,
      `${DATE_STATUS_TYPE} ${PARENT_ROLE_CLASS}`,
      s,
      `${DATE_STATUS_TYPE} ${s}`,
      p,
      `${DATE_STATUS_TYPE} ${p}`,
      `${PARENT_ROLE_CLASS} ${s}`,
      `${DATE_STATUS_TYPE} ${PARENT_ROLE_CLASS} ${s}`,
      `${PARENT_ROLE_CLASS} ${p}`,
      `${DATE_STATUS_TYPE} ${PARENT_ROLE_CLASS} ${p}`,
      `${s} ${PARENT_ROLE_CLASS}`,
      `${DATE_STATUS_TYPE} ${s} ${PARENT_ROLE_CLASS}`,
      `${s} ${p}`,
      `${DATE_STATUS_TYPE} ${s} ${p}`,
      `${p} ${PARENT_ROLE_CLASS}`,
      `${DATE_STATUS_TYPE} ${p} ${PARENT_ROLE_CLASS}`,
      `${p} ${s}`,
      `${DATE_STATUS_TYPE} ${p} ${s}`,
    ]);
  });

  it('never pairs two calendars (only cross-group), so the set stays linear in the calendar count', () => {
    const calendar = Array.from({ length: 10 }, (_, i) => ({ value: `cal-${i}`, color: '#0a0' }));
    const ids = buildTreatmentTaskTypes({ ...palettes, calendar }).map((t) => t.id);
    // Two distinct calendars never co-occur on one bar (a bar has one calendar),
    // so their pair is dead weight and is not registered.
    expect(ids).not.toContain(`${calendarSlug('cal-0')} ${calendarSlug('cal-1')}`);
    // But a calendar pairs with a status/priority (different source groups).
    expect(ids).toContain(`${calendarSlug('cal-0')} ${statusSlug('wip')}`);
    expect(ids).toContain(`${statusSlug('wip')} ${calendarSlug('cal-0')}`);
  });

  it('grows the registered-type count linearly, not quadratically, in the calendar count', () => {
    const count = (n: number): number =>
      buildTreatmentTaskTypes({
        ...palettes,
        calendar: Array.from({ length: n }, (_, i) => ({ value: `cal-${i}`, color: '#0a0' })),
      }).length;
    // Each added calendar contributes a fixed number of ids (its singles plus its
    // cross-group pairs), so the count is exactly linear: doubling the span of
    // added calendars doubles the growth. A quadratic cross-product would ~4x it.
    expect(count(40) - count(20)).toBe((count(20) - count(10)) * 2);
  });

  describe('crossGroupClassPairs — the ordered two-class pairing core', () => {
    it('pairs every class across distinct groups, in both orders, fill-major', () => {
      expect([...crossGroupClassPairs([['a'], ['x', 'y']])]).toEqual([
        ['a', 'x'],
        ['a', 'y'],
        ['x', 'a'],
        ['y', 'a'],
      ]);
    });

    it('never pairs classes drawn from the same group (including a class with itself)', () => {
      expect([...crossGroupClassPairs([['a', 'b']])]).toEqual([]);
    });

    it('spans every distinct group pair when there are more than two groups', () => {
      const pairs = [...crossGroupClassPairs([['a'], ['b'], ['c']])];
      expect(pairs).toEqual([
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'a'],
        ['b', 'c'],
        ['c', 'a'],
        ['c', 'b'],
      ]);
    });

    it('produces no pairs for empty input', () => {
      expect([...crossGroupClassPairs([])]).toEqual([]);
    });
  });

  it('covers every composed form a priority + cue bar can produce (whole-string contract)', () => {
    // A date-flagged, priority-colored, replicated, context bar — worst case.
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'x', sourcePath: 's.md', dateStatus: 'swapped', priority: 'high', isFetched: true }),
          inst({ id: 'y', sourcePath: 's.md', dateStatus: 'swapped', priority: 'high', isFetched: true }),
        ],
        barFillSource: 'priority',
        priorityColors: palettes.priority,
      }),
    );
    const expected = `${DATE_STATUS_TYPE} ${prioritySlug('high')} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`;
    expect(tasks[0]!.type).toBe(expected);
    const registered = buildInstanceCueTaskTypes(buildTreatmentTaskTypes(palettes).map((t) => t.id)).map(
      (t) => t.id,
    );
    expect(registered).toContain(expected);
  });
});

describe('instance cues (U6)', () => {
  it('marks both bars replicated when a source path appears more than once', () => {
    // Same note shown under two parents → two instances, distinct ids.
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'p1', sourcePath: 'shared.md' }),
          inst({ id: 'p2', sourcePath: 'shared.md' }),
        ],
      }),
    );
    for (const t of tasks) {
      expect(t.type.split(' ')).toContain(REPLICATED_TYPE);
      expect(t.custom.isReplicated).toBe(true);
    }
  });

  it('carries isTopLevelPlacement onto the SVAR task custom (#161 — drives the Hide-top filter-tasks predicate)', () => {
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'dup', isTopLevelPlacement: true }),
          inst({ id: 'real', isTopLevelPlacement: false }),
        ],
      }),
    );
    // The view's filter-tasks predicate reads exactly this flag to hide the
    // also-top-level duplicate placement while keeping the real nested copy.
    expect(tasks.find((t) => t.id === 'dup')!.custom.isTopLevelPlacement).toBe(true);
    expect(tasks.find((t) => t.id === 'real')!.custom.isTopLevelPlacement).toBe(false);
  });

  it('folds the effective override meaning onto the SVAR task custom (R11 — drives the tick)', () => {
    const [t] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', interpretationOverridden: 'calendar-days' })] }),
    );
    expect(t.custom.interpretationOverridden).toBe('calendar-days');
    // A task following the view default carries nothing (no tick).
    const [plain] = buildSvarTasks(inputs({ instances: [inst({ id: 'b' })] }));
    expect(plain.custom.interpretationOverridden).toBeUndefined();
  });

  it('taskStateKey changes when the override tick appears or its direction flips (re-sync guard)', () => {
    const keyFor = (interpretationOverridden?: 'working-days' | 'calendar-days') =>
      taskStateKey(buildSvarTasks(inputs({ instances: [inst({ id: 'a', interpretationOverridden })] }))[0]);
    // Appearing, disappearing, and flipping direction must each re-issue the task —
    // otherwise a per-task override toggle leaves the tick stale on an unchanged span.
    expect(keyFor(undefined)).not.toBe(keyFor('calendar-days'));
    expect(keyFor('working-days')).not.toBe(keyFor('calendar-days'));
  });

  it('does not mark a unique source path replicated', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    expect(t.type.split(' ')).not.toContain(REPLICATED_TYPE);
    expect(t.custom.isReplicated).toBe(false);
  });

  // Replicated counts only VISIBLE instances: the always-emitted `alsoTopLevel`
  // duplicate top-level placement must not inflate the count when Hide-top is
  // suppressing it (else a single-parent note shown once is wrongly hatched).
  it('does NOT mark a single-parent note replicated when Hide-top hides its top-level twin', () => {
    const sourcePath = 'child.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: true,
        instances: [
          inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    const nested = tasks.find((t) => t.id === 'child#parent-p')!;
    expect(nested.custom.isReplicated).toBe(false);
    expect(nested.type.split(' ')).not.toContain(REPLICATED_TYPE);
  });

  it('DOES mark the same note replicated when Hide-top is off (root + nested both visible)', () => {
    const sourcePath = 'child.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: false,
        instances: [
          inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    for (const t of tasks) {
      expect(t.custom.isReplicated).toBe(true);
      expect(t.type.split(' ')).toContain(REPLICATED_TYPE);
    }
  });

  it('still marks a genuine multi-parent note replicated under Hide-top (both nested copies count)', () => {
    // Two nested placements (isTopLevelPlacement=false) plus the alsoTopLevel twin;
    // Hide-top suppresses only the twin, leaving 2 visible → replicated.
    const sourcePath = 'multi.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: true,
        instances: [
          inst({ id: 'multi#parent-a', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'multi#parent-b', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'multi', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    const nested = tasks.filter((t) => t.id !== 'multi');
    for (const t of nested) {
      expect(t.custom.isReplicated).toBe(true);
    }
  });

  it('does not mark a fan-out-collapsed source (single instance) replicated', () => {
    const [t] = buildSvarTasks(
      inputs({ hideTopLevelSubtasks: true, instances: [inst({ id: 'x', isCollapsed: true })] }),
    );
    expect(t.custom.isReplicated).toBe(false);
  });

  it('treats a missing hideTopLevelSubtasks as hide-off (buildSvarTasks default counts the twin)', () => {
    const sourcePath = 'child.md';
    // Omit hideTopLevelSubtasks entirely to exercise the `= false` destructure default.
    const tasks = buildSvarTasks({
      instances: [
        inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
        inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
      ],
      links: [],
      statusColors: [],
      showDateIndicators: true,
      arrowMode: 'primary',
    });
    expect(tasks.every((t) => t.custom.isReplicated)).toBe(true);
  });

  it('marks a fetched (out-of-filter) instance as context', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'f', isFetched: true })] }));
    expect(t.type.split(' ')).toContain(CONTEXT_TYPE);
    expect(t.custom.isContext).toBe(true);
  });

  it('does not mark an in-filter instance as context', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'm', isFetched: false })] }));
    expect(t.type.split(' ')).not.toContain(CONTEXT_TYPE);
    expect(t.custom.isContext).toBe(false);
  });

  it('composes cues after state classes, replicated before context, in registration order', () => {
    // A date-flagged, status-colored, replicated, context bar — the worst case.
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'x', sourcePath: 's.md', dateStatus: 'swapped', status: 'wip', isFetched: true }),
          inst({ id: 'y', sourcePath: 's.md', dateStatus: 'swapped', status: 'wip', isFetched: true }),
        ],
        statusColors: colors,
      }),
    );
    const expected = `${DATE_STATUS_TYPE} ${statusSlug('wip')} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`;
    expect(tasks[0]!.type).toBe(expected);
    // The coupling contract: that exact whole string must be a registered type id,
    // or SVAR's whole-string match drops every cue/state class to plain "task".
    const registered = buildInstanceCueTaskTypes(
      buildTreatmentTaskTypes({ status: colors, priority: [] }).map((t) => t.id),
    ).map((t) => t.id);
    expect(registered).toContain(expected);
  });

  it('registers cue-only forms and the cross-product with base types', () => {
    const base = [DATE_STATUS_TYPE];
    const ids = buildInstanceCueTaskTypes(base).map((t) => t.id);
    // Cue-only (a plain bar that is replicated/context with no state class).
    expect(ids).toContain(REPLICATED_TYPE);
    expect(ids).toContain(CONTEXT_TYPE);
    expect(ids).toContain(`${REPLICATED_TYPE} ${CONTEXT_TYPE}`);
    // Crossed with each base id.
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${REPLICATED_TYPE}`);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`);
  });

  // The read-only event-row cue joins the registered superset — an
  // unregistered composite `type` silently collapses to plain `task` in SVAR,
  // dropping the row's read-only styling.
  it('registers the og-event cue and its base-crossed forms', () => {
    const ids = buildInstanceCueTaskTypes([DATE_STATUS_TYPE]).map((t) => t.id);
    expect(ids).toContain(EVENT_TYPE);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${EVENT_TYPE}`);
  });

  it('stamps a calendar-item row with og-event and the composed type round-trips through registration', () => {
    const eventId = 'og-calendar://timeblock/Calendar%2Fblocks.md@2026-08-03';
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: eventId,
            sourcePath: eventId,
            calendarItem: {
              id: eventId,
              family: 'timeblock',
              title: 'Deep work',
              startDay: '2026-08-03',
              endDay: '2026-08-03',
              notePath: 'Calendar/blocks.md',
            },
          }),
        ],
      }),
    );
    expect(tasks[0]!.type).toBe(EVENT_TYPE);
    const registered = buildInstanceCueTaskTypes([DATE_STATUS_TYPE]).map((t) => t.id);
    expect(registered).toContain(tasks[0]!.type);
  });

  it('threads a safe calendar-item source color into the bar payload', () => {
    const eventId = makeCalendarItemId('external-event', 'ics:work@2026-08-03');
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: eventId,
            sourcePath: eventId,
            calendarItem: {
              id: eventId,
              family: 'external-event',
              title: 'Team sync',
              startDay: '2026-08-03',
              endDay: '2026-08-03',
              color: '#c0392b',
            },
          }),
        ],
      }),
    );

    expect(task?.custom.calendarItemColor).toBe('#c0392b');
  });

  it('drops an unsafe calendar-item source color from the bar payload', () => {
    const eventId = makeCalendarItemId('external-event', 'ics:work@2026-08-03');
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: eventId,
            sourcePath: eventId,
            calendarItem: {
              id: eventId,
              family: 'external-event',
              title: 'Team sync',
              startDay: '2026-08-03',
              endDay: '2026-08-03',
              color: 'red; background: url(bad)',
            },
          }),
        ],
      }),
    );

    expect(task?.custom.calendarItemColor).toBeUndefined();
  });

  it('re-syncs a calendar-item row when only its source color changes', () => {
    const eventId = makeCalendarItemId('timeblock', 'daily@block');
    const taskWithColor = (color: string) =>
      buildSvarTasks(
        inputs({
          instances: [
            inst({
              id: eventId,
              sourcePath: eventId,
              calendarItem: {
                id: eventId,
                family: 'timeblock',
                title: 'Focus',
                startDay: '2026-08-03',
                endDay: '2026-08-03',
                color,
              },
            }),
          ],
        }),
      )[0]!;

    expect(taskStateKey(taskWithColor('#c0392b'))).not.toBe(
      taskStateKey(taskWithColor('#2980b9')),
    );
  });
});

describe('planTaskSync', () => {
  it('returns an empty plan when nothing changed', () => {
    const tasks = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    const plan = planTaskSync(mapOf(tasks), tasks);
    expect(plan).toEqual({ moves: [], updates: [], deletes: [], adds: [] });
  });

  it('emits an update only for a field-changed task', () => {
    const prev = buildSvarTasks(inputs({ instances: [inst({ id: 'a', progress: 0 })] }));
    const next = buildSvarTasks(inputs({ instances: [inst({ id: 'a', progress: 50 })] }));
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.adds).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
  });

  // U2 guardrail (#161): flipping "Hide top-level subtasks" changes only the
  // replicated cue (a task `type`), never row membership — so the live re-sync on
  // the toggle is update-only, preserving scroll/zoom and never churning.
  it('flipping Hide-top yields an update-only plan (no add/delete/move) — churn-safe', () => {
    const sourcePath = 'child.md';
    const instances = [
      inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
      inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
    ];
    const hideOff = buildSvarTasks(inputs({ instances, hideTopLevelSubtasks: false }));
    const hideOn = buildSvarTasks(inputs({ instances, hideTopLevelSubtasks: true }));
    const plan = planTaskSync(mapOf(hideOff), hideOn);
    expect(plan.updates.length).toBeGreaterThan(0);
    expect(plan.adds).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.moves).toHaveLength(0);
  });

  it('orders adds parent-first even when next lists the child before the parent', () => {
    const prev: SvarTask[] = [];
    // child appears before parent in the array
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'c', parent: 'p' }), inst({ id: 'p' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    const order = plan.adds.map((t) => t.id);
    expect(order.indexOf('p')).toBeLessThan(order.indexOf('c'));
  });

  it('orders deletes leaf-first (children before parents)', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' }), inst({ id: 'g', parent: 'c' })] }),
    );
    const plan = planTaskSync(mapOf(prev), []); // everything removed
    const order = plan.deletes;
    expect(order.indexOf('g')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('p'));
  });

  it('emits a move (and an accompanying update) when a task is reparented', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p1' }), inst({ id: 'p2' }), inst({ id: 'c', parent: 'p1' })] }),
    );
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p1' }), inst({ id: 'p2' }), inst({ id: 'c', parent: 'p2' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.moves).toEqual([{ id: 'c', parent: 'p2' }]);
    // parent change always alters the state key → an update is emitted too
    expect(plan.updates.map((u) => u.id)).toContain('c');
  });

  it('moves a task to root (target 0) when its parent is removed', () => {
    const prev = buildSvarTasks(inputs({ instances: [inst({ id: 'c', parent: 'p' })] }));
    const next = buildSvarTasks(inputs({ instances: [inst({ id: 'c' })] })); // no parent
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.moves).toEqual([{ id: 'c', parent: 0 }]);
  });

  it('handles simultaneous add, update, and delete in one diff', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'keep', progress: 0 }), inst({ id: 'gone' })] }),
    );
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'keep', progress: 80 }), inst({ id: 'new' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.updates.map((u) => u.id)).toEqual(['keep']);
    expect(plan.adds.map((t) => t.id)).toEqual(['new']);
    expect(plan.deletes).toEqual(['gone']);
  });
});

describe('buildSvarTasks — grid property values (U4)', () => {
  const propsFor = (entries: Array<[string, Record<string, TypedValue>]>) =>
    new Map<string, Record<string, TypedValue>>(entries);

  it('attaches custom.properties by source path', () => {
    const pv = propsFor([['a.md', { 'note.status': { kind: 'text', value: 'wip' } }]]);
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })], propertyValues: pv }));
    expect(t.custom.properties).toEqual({ 'note.status': { kind: 'text', value: 'wip' } });
  });

  it('defaults custom.properties to {} when the task has no resolved values', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })] }));
    expect(t.custom.properties).toEqual({});
  });
});

describe('buildSvarTasks — row editability', () => {
  it('marks a TaskNotes-managed source path editable and an unmanaged one not', () => {
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'a', sourcePath: 'tasks/a.md' }),
          inst({ id: 'b', sourcePath: 'notes/plain.md' }),
        ],
        managedPaths: new Set(['tasks/a.md']),
      }),
    );
    expect(tasks[0]!.custom.editable).toBe(true);
    expect(tasks[1]!.custom.editable).toBe(false);
  });

  it('marks a companion-fetched instance not editable when its path is unmanaged', () => {
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'ctx', sourcePath: 'notes/plain.md', isFetched: true })],
        managedPaths: new Set(['tasks/other.md']),
      }),
    );
    expect(t.custom.editable).toBe(false);
  });

  it('defaults to not editable when no managed set is provided', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    expect(t.custom.editable).toBe(false);
  });

  it('taskStateKey changes when editability flips (re-sync guard)', () => {
    const build = (managedPaths?: ReadonlySet<string>) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })], managedPaths }))[0]!;
    expect(taskStateKey(build(new Set(['a.md'])))).not.toBe(taskStateKey(build()));
  });
});

describe('taskStateKey', () => {
  it('changes when a displayed property value changes, is stable for a date, and ignores unmapped props', () => {
    const pv = (status: string) =>
      new Map<string, Record<string, TypedValue>>([
        ['a.md', { 'note.status': { kind: 'text', value: status }, 'note.start': { kind: 'date', value: new Date(2026, 0, 1) } }],
      ]);
    const build = (status: string) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })], propertyValues: pv(status) }))[0];

    // A displayed value change → different key.
    expect(taskStateKey(build('wip'))).not.toBe(taskStateKey(build('done')));
    // Same content (incl. a date-kind value) → identical key across rebuilds (no churn).
    expect(taskStateKey(build('wip'))).toBe(taskStateKey(build('wip')));
  });

  it('changes when a date moves', () => {
    const [a] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', start: new Date(2026, 0, 1) })] }));
    const [b] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', start: new Date(2026, 0, 5) })] }));
    expect(taskStateKey(a)).not.toBe(taskStateKey(b));
  });

  it('changes when a ghost run moves inside an unchanged span (moved-holiday fingerprint)', () => {
    const build = (startDate: string) =>
      buildSvarTasks(
        inputs({ instances: [inst({ id: 'a', ghostRuns: [{ startDate, days: 1 }] })] }),
      )[0];
    expect(taskStateKey(build('2026-04-14'))).not.toBe(taskStateKey(build('2026-04-16')));
    expect(taskStateKey(build('2026-04-14'))).toBe(taskStateKey(build('2026-04-14')));
  });

  it('threads ghostRuns onto SvarTask.custom for the bar template', () => {
    const ghostRuns = [{ startDate: '2026-04-11', days: 2 }];
    const [built] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', ghostRuns })] }));
    expect(built?.custom.ghostRuns).toEqual(ghostRuns);
  });

  it('threads stretchFlagged onto SvarTask.custom (true when flagged, absent otherwise) so echo and refresh agree', () => {
    const [flagged] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', stretchFlagged: true })] }));
    const [plain] = buildSvarTasks(inputs({ instances: [inst({ id: 'b' })] }));
    expect(flagged?.custom.stretchFlagged).toBe(true);
    expect(plain?.custom.stretchFlagged).toBeUndefined();
  });

  it('is identical for identical content', () => {
    const [a] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    const [b] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    expect(taskStateKey(a)).toBe(taskStateKey(b));
  });

  it('is identical regardless of custom.dateStatus (KTD3 diff-safety guard)', () => {
    // dateStatus rides into custom for the view filter but MUST NOT enter the
    // task-update fingerprint — otherwise a date-status change would inflate the
    // SVAR diff (#161). Same content, different dateStatus → same key.
    const [a] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'complete' })], showDateIndicators: false }),
    );
    const [b] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', dateStatus: 'placeholder' })],
        showDateIndicators: false,
      }),
    );
    expect(a.custom.dateStatus).not.toBe(b.custom.dateStatus);
    expect(taskStateKey(a)).toBe(taskStateKey(b));
  });
});

/**
 * Every field of a task, and what perturbing it must do to the fingerprint.
 *
 * The member lists are `Record<keyof …>`, so adding a field to `SvarTask` or to
 * its `custom` bag does not compile until a decision is recorded here. That is
 * the property a hand-written list of guards cannot have: a list simply omits a
 * field and nothing fails — which is how `end` came to be droppable from the
 * fold with the whole suite green.
 *
 * That completeness is carried by `npm run typecheck`, NOT by this suite: the
 * jest transform strips types without checking them, so a green `npx jest` is
 * never evidence the census is complete.
 *
 * Bounded honestly: the members derive from the `SvarTask` TYPE, so this cannot
 * see a value the fingerprint reads off some other object; `changes` verifies
 * only that the named perturbation moves the key, not that the key encodes the
 * field faithfully; and a composite field is perturbed into EXISTENCE, so the
 * key moves on presence alone and NOTHING here requires a component inside it
 * to reach the key.
 *
 * Component-level cover is a separate question this census does not answer.
 * Some composites have a sub-key census below; which ones is not enumerated
 * here, because a list of them would be exactly the hand-maintained member list
 * this census exists to replace — it would go stale the first time a composite
 * was added without editing it. Read the censuses, not a summary of them.
 */
type FieldCensus<T> =
  | { effect: 'changes'; perturb: (t: T) => T }
  | { effect: 'ignored'; why: string; perturb: (t: T) => T };

describe('taskStateKey — folded-field census', () => {
  const baseTask = (): SvarTask => buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }))[0]!;
  const withCustom =
    (over: Partial<SvarTask['custom']>) =>
    (t: SvarTask): SvarTask => ({ ...t, custom: { ...t.custom, ...over } });

  // `custom` is excluded from the key set, not recorded as an exempt entry: it is
  // delegated to CUSTOM by construction, so no field can opt out of an assertion
  // by declaring itself covered elsewhere.
  const TOP_LEVEL: Record<Exclude<keyof SvarTask, 'custom'>, FieldCensus<SvarTask>> = {
    id: {
      effect: 'ignored',
      why: 'the diff keys ON id — a different id is a different row, not a changed one',
      perturb: (t) => ({ ...t, id: 'other' }),
    },
    text: { effect: 'changes', perturb: (t) => ({ ...t, text: `${t.text} renamed` }) },
    start: { effect: 'changes', perturb: (t) => ({ ...t, start: new Date(2030, 0, 1) }) },
    end: { effect: 'changes', perturb: (t) => ({ ...t, end: new Date(2030, 0, 2) }) },
    progress: { effect: 'changes', perturb: (t) => ({ ...t, progress: t.progress + 10 }) },
    type: { effect: 'changes', perturb: (t) => ({ ...t, type: `${t.type} extra` }) },
    parent: { effect: 'changes', perturb: (t) => ({ ...t, parent: 'other-parent' }) },
    open: { effect: 'changes', perturb: (t) => ({ ...t, open: !(t.open ?? false) }) },
  };

  const CUSTOM: Record<keyof SvarTask['custom'], FieldCensus<SvarTask>> = {
    isVirtual: { effect: 'changes', perturb: withCustom({ isVirtual: true }) },
    isCollapsed: { effect: 'changes', perturb: withCustom({ isCollapsed: true }) },
    showHasDeps: { effect: 'changes', perturb: withCustom({ showHasDeps: true }) },
    editable: { effect: 'changes', perturb: withCustom({ editable: true }) },
    dateStatusToken: {
      effect: 'changes',
      perturb: withCustom({ dateStatusToken: ZIGZAG_START }),
    },
    barIcon: {
      effect: 'changes',
      perturb: withCustom({ barIcon: { kind: 'status', color: '#c0392b' } }),
    },
    properties: {
      effect: 'changes',
      perturb: withCustom({ properties: { 'note.status': { kind: 'text', value: 'wip' } } }),
    },
    cellRenders: {
      effect: 'changes',
      perturb: withCustom({ cellRenders: { 'note.title': { mode: 'markdown', source: '[[A]]' } } }),
    },
    ghostRuns: {
      effect: 'changes',
      perturb: withCustom({ ghostRuns: [{ startDate: '2026-04-14', days: 1 }] }),
    },
    occupancyRuns: {
      effect: 'changes',
      perturb: withCustom({ occupancyRuns: [{ startDate: '2026-04-14', days: 1 }] }),
    },
    occupancyEnvelope: { effect: 'changes', perturb: withCustom({ occupancyEnvelope: true }) },
    hasRecurringOccupancy: {
      effect: 'changes',
      perturb: withCustom({ hasRecurringOccupancy: true }),
    },
    calendarItemColor: {
      effect: 'changes',
      perturb: withCustom({ calendarItemColor: '#2980b9' }),
    },
    interpretationOverridden: {
      effect: 'changes',
      perturb: withCustom({ interpretationOverridden: 'working-days' }),
    },
    incomingDeps: {
      effect: 'changes',
      perturb: withCustom({
        incomingDeps: [
          { reltype: 'FINISHTOSTART', gap: null, predecessorName: 'P', linkId: 'l1' },
        ],
      }),
    },
    sourceTaskId: {
      effect: 'ignored',
      why: 'row provenance, not rendered content',
      perturb: withCustom({ sourceTaskId: 'other.md' }),
    },
    dateStatus: {
      effect: 'ignored',
      why: 'KTD3: it rides custom for the view filter; folding it would inflate the SVAR diff (#161)',
      perturb: withCustom({ dateStatus: 'placeholder' }),
    },
    isReplicated: {
      effect: 'ignored',
      why: 'reaches the fingerprint through the composed bar `type`, not on its own',
      perturb: withCustom({ isReplicated: true }),
    },
    isContext: {
      effect: 'ignored',
      why: 'reaches the fingerprint through the composed bar `type`, not on its own',
      perturb: withCustom({ isContext: true }),
    },
    isTopLevelPlacement: {
      effect: 'ignored',
      why: 'placement decides whether the row exists, not how an existing row paints',
      perturb: withCustom({ isTopLevelPlacement: true }),
    },
    calendarItemFamily: {
      effect: 'ignored',
      why: 'the family is embedded in the row synthetic id, which the diff keys on',
      perturb: withCustom({ calendarItemFamily: 'recurring-instance' }),
    },
    stretchFlagged: {
      effect: 'ignored',
      why: 'echo provenance for geometry write-back, not painted state',
      perturb: withCustom({ stretchFlagged: true }),
    },
  };

  // Namespaced rather than merged: `{ ...TOP_LEVEL, ...CUSTOM }` keys on the bare
  // field name, so a `custom` member sharing a name with a top-level one would
  // overwrite it — both halves still satisfy their own `Record`, and the
  // overwritten field's guard disappears with nothing failing.
  const namespaced = (
    prefix: string,
    record: Record<string, FieldCensus<SvarTask>>,
  ): Array<[string, FieldCensus<SvarTask>]> =>
    Object.entries(record).map(([field, entry]) => [`${prefix}.${field}`, entry]);

  const census = [...namespaced('task', TOP_LEVEL), ...namespaced('custom', CUSTOM)];

  const withEffect =
    <E extends FieldCensus<SvarTask>['effect']>(effect: E) =>
    (
      entry: [string, FieldCensus<SvarTask>],
    ): entry is [string, Extract<FieldCensus<SvarTask>, { effect: E }>] =>
      entry[1].effect === effect;

  // Falsifiable, unlike a count of the census against itself: a third effect
  // added to `FieldCensus` runs no assertion, so its members would vanish from
  // both blocks below. That is how `delegated` once let a field opt out.
  it('runs every census entry through one of the two effects', () => {
    const covered =
      census.filter(withEffect('changes')).length + census.filter(withEffect('ignored')).length;
    expect(covered).toBe(census.length);
  });

  it.each(census.filter(withEffect('changes')))(
    're-issues the row when %s changes',
    (_field, entry) => {
      expect(taskStateKey(entry.perturb(baseTask()))).not.toBe(taskStateKey(baseTask()));
    },
  );

  it.each(census.filter(withEffect('ignored')))(
    'leaves the fingerprint alone when %s changes',
    (_field, entry) => {
      expect(taskStateKey(entry.perturb(baseTask()))).toBe(taskStateKey(baseTask()));
    },
  );
});

describe('taskStateKey — cell-render modes', () => {
  const withRenders = (cellRenders: Record<string, CellRender>): SvarTask => {
    const t = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }))[0]!;
    return { ...t, custom: { ...t.custom, cellRenders } };
  };

  // Every descriptor mode must reach the key. `propertiesKey` deliberately folds
  // the locale-INDEPENDENT canonical value, so the rendered text is the only
  // thing that re-issues a row when what the cell displays moves. Keyed on
  // `CellRender['mode']`, so a third mode does not compile until it is paired
  // here — a hand-written pair would simply not mention it.
  const MODES: Record<CellRender['mode'], [CellRender, CellRender]> = {
    markdown: [
      { mode: 'markdown', source: '[[A]]' },
      { mode: 'markdown', source: '[[B]]' },
    ],
    text: [
      { mode: 'text', text: '1 Jan 2026' },
      { mode: 'text', text: '2 Jan 2026' },
    ],
  };

  it.each(Object.entries(MODES))(
    're-issues the row when a %s cell body changes',
    (mode, [before, after]) => {
      // Both members must BE the mode the case is named for: a pair edited to
      // vary the mode instead would still move the key while testing neither.
      expect([before.mode, after.mode]).toEqual([mode, mode]);
      expect(taskStateKey(withRenders({ t: before }))).not.toBe(
        taskStateKey(withRenders({ t: after })),
      );
    },
  );

  // Pinning each pair to one mode (above) means nothing here requires the mode
  // DISCRIMINATOR to reach the key. Same body, different mode: a cell that
  // stops rendering `*A*` as markdown and starts showing it literally must
  // re-issue the row, and a key built from the body alone collides.
  it('re-issues the row when a cell keeps its body and changes mode', () => {
    expect(taskStateKey(withRenders({ t: { mode: 'text', text: '*A*' } }))).not.toBe(
      taskStateKey(withRenders({ t: { mode: 'markdown', source: '*A*' } })),
    );
  });
});

/**
 * The components INSIDE the composite sub-keys, and what perturbing each must do.
 *
 * The field census above gives a composite field a value where the base task had
 * none, so the key moves on presence alone and no component is required to reach
 * it. Measured, not assumed: dropping `days` from `ghostRunsKey` and
 * `predecessorName` + `reltype` from `incomingDepsKey` left the whole suite
 * green. Every member list is keyed on the component TYPE, so a new member of
 * any of these shapes does not compile until a decision is recorded here.
 *
 * A `Record<keyof Shape, [Shape, Shape]>` forces one pair per component but not
 * that the pair differs IN that component — a pair edited to vary something else
 * would still move the key and stay green while its named component became
 * droppable again. So each case asserts its own isolation first: the two members
 * must differ in exactly the component the case is named for.
 *
 * Same bound as the field census: this proves the component reaches the key, not
 * that the key encodes it faithfully.
 */
describe('taskStateKey — composite sub-key components', () => {
  const baseTask = (): SvarTask => buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }))[0]!;
  const withCustom =
    (over: Partial<SvarTask['custom']>) =>
    (t: SvarTask): SvarTask => ({ ...t, custom: { ...t.custom, ...over } });

  const differingKeys = <T extends object>(a: T, b: T): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => a[k as keyof T] !== b[k as keyof T])
      .sort();

  /** Asserts the pair isolates `component`, then that the component reaches the key. */
  const expectComponentFolded = <T extends object>(
    component: string,
    [before, after]: [T, T],
    fold: (value: T) => SvarTask,
  ): void => {
    expect(differingKeys(before, after)).toEqual([component]);
    expect(taskStateKey(fold(before))).not.toBe(taskStateKey(fold(after)));
  };

  // Every array-valued composite folds the perturbed element SECOND, behind a
  // fixed leading element: a fold that read only index 0 would otherwise satisfy
  // every case below. Order is asserted separately — reading both elements is
  // not the same as keeping them apart.
  type GhostRun = NonNullable<SvarTask['custom']['ghostRuns']>[number];

  const LEADING_GHOST_RUN: GhostRun = { startDate: '2026-01-02', days: 5 };
  const LEADING_OCCUPANCY_RUN: OccupancyRunSpan = { startDate: '2026-01-02', days: 5 };
  const LEADING_DEP: IncomingDep = {
    reltype: 'FINISHTOFINISH',
    gap: null,
    predecessorName: 'Other',
    linkId: 'l9',
  };

  const GHOST_RUN: Record<keyof GhostRun, [GhostRun, GhostRun]> = {
    startDate: [
      { startDate: '2026-04-14', days: 2 },
      { startDate: '2026-04-15', days: 2 },
    ],
    // A holiday that lengthens in place moves nothing else: without this the bar
    // keeps painting the old run until an unrelated edit re-issues the row.
    days: [
      { startDate: '2026-04-14', days: 2 },
      { startDate: '2026-04-14', days: 3 },
    ],
  };

  it.each(Object.entries(GHOST_RUN))(
    're-issues the row when a ghost run %s changes',
    (component, pair) => {
      expectComponentFolded(component, pair, (span) =>
        withCustom({ ghostRuns: [LEADING_GHOST_RUN, span] })(baseTask()),
      );
    },
  );

  it('re-issues the row when two ghost runs swap order', () => {
    const a: GhostRun = { startDate: '2026-04-14', days: 1 };
    const b: GhostRun = { startDate: '2026-04-20', days: 3 };
    expect(taskStateKey(withCustom({ ghostRuns: [a, b] })(baseTask()))).not.toBe(
      taskStateKey(withCustom({ ghostRuns: [b, a] })(baseTask())),
    );
  });

  const run = (over: Partial<OccupancyRunSpan>): OccupancyRunSpan => ({
    startDate: '2026-04-14',
    days: 2,
    ...over,
  });

  const OCCUPANCY_RUN: Record<keyof OccupancyRunSpan, [OccupancyRunSpan, OccupancyRunSpan]> = {
    startDate: [run({ startDate: '2026-04-14' }), run({ startDate: '2026-04-15' })],
    days: [run({ days: 2 }), run({ days: 3 })],
    stateClass: [run({ stateClass: 'projected' }), run({ stateClass: 'completed' })],
    // A materialized occurrence's backing note decides where a piece click lands;
    // without this the piece keeps opening the note it used to point at.
    notePath: [run({ notePath: 'a.md' }), run({ notePath: 'b.md' })],
  };

  it.each(Object.entries(OCCUPANCY_RUN))(
    're-issues the row when an occupancy run %s changes',
    (component, pair) => {
      expectComponentFolded(component, pair, (span) =>
        withCustom({ occupancyRuns: [LEADING_OCCUPANCY_RUN, span] })(baseTask()),
      );
    },
  );

  // Two overlapping runs where the later one decides the painted state and the
  // click target: an order-insensitive fold would leave the row un-reissued.
  it('re-issues the row when two occupancy runs swap order', () => {
    const a = run({ startDate: '2026-04-14', stateClass: 'projected' });
    const b = run({ startDate: '2026-04-14', stateClass: 'materialized', notePath: 'b.md' });
    expect(taskStateKey(withCustom({ occupancyRuns: [a, b] })(baseTask()))).not.toBe(
      taskStateKey(withCustom({ occupancyRuns: [b, a] })(baseTask())),
    );
  });

  const icon = (over: Partial<IconSpec>): IconSpec => ({
    kind: 'status',
    color: '#c0392b',
    ...over,
  });

  const BAR_ICON: Record<keyof IconSpec, [IconSpec, IconSpec]> = {
    kind: [icon({ kind: 'status' }), icon({ kind: 'priority' })],
    // A status keeping its kind and completion while its configured glyph or
    // colour changes: without these the row keeps rendering the old chip.
    iconName: [icon({ iconName: 'circle' }), icon({ iconName: 'square' })],
    color: [icon({ color: '#c0392b' }), icon({ color: '#2980b9' })],
    completed: [icon({ completed: true }), icon({ completed: undefined })],
  };

  it.each(Object.entries(BAR_ICON))(
    're-issues the row when a bar icon %s changes',
    (component, pair) => {
      expectComponentFolded(component, pair, (spec) =>
        withCustom({ barIcon: spec })(baseTask()),
      );
    },
  );

  const dep = (over: Partial<IncomingDep>): IncomingDep => ({
    reltype: 'FINISHTOSTART',
    gap: null,
    predecessorName: 'P',
    linkId: 'l1',
    ...over,
  });

  const INCOMING_DEP: Record<keyof IncomingDep, [IncomingDep, IncomingDep]> = {
    reltype: [dep({ reltype: 'FINISHTOSTART' }), dep({ reltype: 'STARTTOSTART' })],
    gap: [dep({ gap: null }), dep({ gap: 'P1D' })],
    // Renaming a predecessor changes only the tooltip's wording; without this the
    // blocked row keeps showing the old name.
    predecessorName: [
      dep({ predecessorName: 'Draft docs' }),
      dep({ predecessorName: 'Draft specs' }),
    ],
    linkId: [dep({ linkId: 'l1' }), dep({ linkId: 'l2' })],
  };

  it.each(Object.entries(INCOMING_DEP))(
    're-issues the row when an incoming dependency %s changes',
    (component, pair) => {
      expectComponentFolded(component, pair, (edge) =>
        withCustom({ incomingDeps: [LEADING_DEP, edge] })(baseTask()),
      );
    },
  );

  it('re-issues the row when two incoming dependencies swap order', () => {
    const a = dep({ linkId: 'l1', predecessorName: 'Draft docs' });
    const b = dep({ linkId: 'l2', predecessorName: 'Draft specs' });
    expect(taskStateKey(withCustom({ incomingDeps: [a, b] })(baseTask()))).not.toBe(
      taskStateKey(withCustom({ incomingDeps: [b, a] })(baseTask())),
    );
  });
});

describe('planLinkSync', () => {
  const link = (id: string, source = 's', target = 't'): RenderLink => ({ id, source, target, type: 'e2s', reltype: 'FINISHTOSTART', gap: null });

  it('adds new links and deletes removed ones by id', () => {
    const prev = new Map([['L1', link('L1')]]);
    const next = [link('L2')];
    const plan = planLinkSync(prev, next);
    expect(plan.adds.map((l) => l.id)).toEqual(['L2']);
    expect(plan.deletes).toEqual(['L1']);
  });

  it('is a no-op when the link set is unchanged', () => {
    const prev = new Map([['L1', link('L1')]]);
    const plan = planLinkSync(prev, [link('L1')]);
    expect(plan).toEqual({ deletes: [], adds: [] });
  });
});

describe('planReorder', () => {
  it('chains move-after within a root branch to match the desired order', () => {
    const moves = planReorder([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(moves).toEqual([
      { id: 'b', after: 'a' },
      { id: 'c', after: 'b' },
    ]);
  });

  it('reorders each parent branch independently (tree-preserving)', () => {
    const moves = planReorder([
      { id: 'P' },
      { id: 'c1', parent: 'P' },
      { id: 'c2', parent: 'P' },
      { id: 'Q' },
      { id: 'd1', parent: 'Q' },
    ]);
    // Root branch [P, Q] → Q after P; P's children c1,c2 → c2 after c1; Q's lone child → no move.
    expect(moves).toEqual([
      { id: 'Q', after: 'P' },
      { id: 'c2', after: 'c1' },
    ]);
  });

  it('emits no moves for single-child branches or an empty set', () => {
    expect(planReorder([])).toEqual([]);
    expect(planReorder([{ id: 'only' }])).toEqual([]);
    expect(planReorder([{ id: 'P' }, { id: 'c', parent: 'P' }])).toEqual([]);
  });
});

describe('baseSortDescriptor', () => {
  it('is empty when there is no Base sort', () => {
    expect(baseSortDescriptor([])).toBe('');
    expect(baseSortDescriptor(undefined)).toBe('');
  });

  it('folds the property+direction pairs into a stable string', () => {
    expect(baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }])).toBe('note.due:ASC');
    expect(
      baseSortDescriptor([
        { property: 'note.due', direction: 'ASC' },
        { property: 'file.name', direction: 'DESC' },
      ]),
    ).toBe('note.due:ASC|file.name:DESC');
  });

  it('is identical for two getSort() results with the same keys+directions (data-only refresh)', () => {
    const a = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const b = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    expect(a).toBe(b);
  });

  it('changes when the direction changes (user re-sorted the Base)', () => {
    const asc = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const desc = baseSortDescriptor([{ property: 'note.due', direction: 'DESC' }]);
    expect(asc).not.toBe(desc);
  });

  it('changes when the sort property changes', () => {
    const due = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const name = baseSortDescriptor([{ property: 'file.name', direction: 'ASC' }]);
    expect(due).not.toBe(name);
  });

  it('preserves order significance (compound sort is order-sensitive)', () => {
    const ab = baseSortDescriptor([
      { property: 'a', direction: 'ASC' },
      { property: 'b', direction: 'ASC' },
    ]);
    const ba = baseSortDescriptor([
      { property: 'b', direction: 'ASC' },
      { property: 'a', direction: 'ASC' },
    ]);
    expect(ab).not.toBe(ba);
  });
});

describe('shouldBulkReseed (#161 U6 — large-diff bulk reseed decision)', () => {
  // The decision only reads array lengths, so plans are built with length-accurate
  // stub arrays (content is irrelevant to the structural-op count under test).
  const stub = <T>(n: number): T[] => Array.from({ length: n }, (_, i) => ({ id: `x${i}` } as unknown as T));
  function plan(c: { adds?: number; deletes?: number; moves?: number; updates?: number }): TaskSyncPlan {
    return {
      adds: stub<SvarTask>(c.adds ?? 0),
      deletes: Array.from({ length: c.deletes ?? 0 }, (_, i) => `d${i}`),
      moves: Array.from({ length: c.moves ?? 0 }, (_, i) => ({ id: `m${i}`, parent: 0 as const })),
      updates: Array.from({ length: c.updates ?? 0 }, (_, i) => ({ id: `u${i}`, task: { id: `u${i}` } as unknown as SvarTask })),
    };
  }
  function linkPlan(c: { adds?: number; deletes?: number }): LinkSyncPlan {
    return { adds: stub<RenderLink>(c.adds ?? 0), deletes: Array.from({ length: c.deletes ?? 0 }, (_, i) => `l${i}`) };
  }

  it('returns false for an empty plan (a NOOP sync is never a reseed)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({}))).toBe(false);
  });

  it('returns false for a small interactive edit (1 move + 2 updates)', () => {
    expect(shouldBulkReseed(plan({ moves: 1, updates: 2 }), linkPlan({}))).toBe(false);
  });

  it('keeps a large field-only refresh incremental (updates are excluded from the count)', () => {
    // 500 in-place updates, zero structural ops → stays incremental, preserving view state (R2).
    expect(shouldBulkReseed(plan({ updates: 500 }), linkPlan({}))).toBe(false);
  });

  it('returns true for a wholesale add of many tasks (search→clear re-expands the tree)', () => {
    expect(shouldBulkReseed(plan({ adds: 800 }), linkPlan({}))).toBe(true);
  });

  it('returns true for a wholesale delete of many tasks (search filters to empty)', () => {
    expect(shouldBulkReseed(plan({ deletes: 800 }), linkPlan({}))).toBe(true);
  });

  it('counts adds + deletes + moves together for a mixed swap', () => {
    const justOver = plan({
      adds: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
      deletes: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
      moves: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
    });
    expect(shouldBulkReseed(justOver, linkPlan({}))).toBe(true);
  });

  it('returns false when structural ops EQUAL the threshold (not strictly over)', () => {
    expect(shouldBulkReseed(plan({ adds: BULK_RESEED_OP_THRESHOLD }), linkPlan({}))).toBe(false);
  });

  it('returns true when structural ops exceed the threshold by one (strict greater-than)', () => {
    expect(shouldBulkReseed(plan({ adds: BULK_RESEED_OP_THRESHOLD + 1 }), linkPlan({}))).toBe(true);
  });

  it('counts link adds + deletes toward the magnitude (0 task ops, many link ops)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({ adds: BULK_RESEED_OP_THRESHOLD, deletes: 1 }))).toBe(true);
  });

  it('applies strict greater-than to link ops too (link ops == threshold → false)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({ adds: BULK_RESEED_OP_THRESHOLD }))).toBe(false);
  });

  it('ignores updates even when they dwarf a sub-threshold structural count', () => {
    // 149 structural ops + 10000 updates → still incremental (updates excluded).
    expect(shouldBulkReseed(plan({ adds: 149, updates: 10000 }), linkPlan({}))).toBe(false);
  });

  it('honors an explicit threshold override', () => {
    const small = plan({ adds: 5 });
    expect(shouldBulkReseed(small, linkPlan({}), 100)).toBe(false);
    expect(shouldBulkReseed(small, linkPlan({}), 4)).toBe(true);
  });

  it('structuralOpCount sums task adds+deletes+moves and link adds+deletes, excluding updates', () => {
    expect(structuralOpCount(plan({}), linkPlan({}))).toBe(0);
    expect(structuralOpCount(plan({ adds: 3, deletes: 2, moves: 1, updates: 99 }), linkPlan({ adds: 4, deletes: 5 }))).toBe(15);
  });
});

describe('echoTaskPatch', () => {
  const geometryPayload = (ghostRuns: Array<{ startDate: string; days: number }>, flagged = false) =>
    ({
      kind: 'geometry',
      geometry: {
        start: new Date(2026, 0, 5),
        end: new Date(2026, 0, 9),
        flagged,
        ghostRuns,
      },
    }) as const;

  const customOf = (over: Partial<RenderInstance> = {}): SvarTask['custom'] =>
    buildSvarTasks(inputs({ instances: [inst({ id: 'a', ...over })] }))[0]!.custom;

  it('maps a progress echo to a progress-only patch', () => {
    expect(echoTaskPatch({ kind: 'progress', progress: 40 }, customOf())).toEqual({
      progress: 40,
    });
  });

  it('carries the full geometry: start/end AND custom.ghostRuns, preserving the rest of the custom record', () => {
    const current = customOf({ ghostRuns: [{ startDate: '2026-01-02', days: 1 }] });
    const runs = [{ startDate: '2026-01-07', days: 2 }];

    const patch = echoTaskPatch(geometryPayload(runs), current);

    expect(patch).toMatchObject({ start: new Date(2026, 0, 5), end: new Date(2026, 0, 9) });
    const custom = (patch as { custom: SvarTask['custom'] }).custom;
    expect(custom.ghostRuns).toEqual(runs);
    // Everything else in the row's custom record rides along untouched.
    expect(custom).toMatchObject({ ...current, ghostRuns: runs });
  });

  it('clears stale ghost runs: an empty derived run list echoes as undefined, matching buildSvarTasks', () => {
    const current = customOf({ ghostRuns: [{ startDate: '2026-01-02', days: 1 }] });

    const patch = echoTaskPatch(geometryPayload([]), current);

    expect((patch as { custom: SvarTask['custom'] }).custom.ghostRuns).toBeUndefined();
  });

  it('stays span-only when the row has no current custom record to advance', () => {
    expect(echoTaskPatch(geometryPayload([{ startDate: '2026-01-07', days: 2 }]), undefined)).toEqual({
      start: new Date(2026, 0, 5),
      end: new Date(2026, 0, 9),
    });
  });

  it('carries the ceiling-fallback provenance: a flagged geometry echoes custom.stretchFlagged, preserving the rest of the record', () => {
    const current = customOf();

    const patch = echoTaskPatch(geometryPayload([], true), current);

    const custom = (patch as { custom: SvarTask['custom'] }).custom;
    expect(custom.stretchFlagged).toBe(true);
    expect(custom).toMatchObject({ ...current, stretchFlagged: true });
  });

  it('clears a stale flag: an unflagged geometry echoes stretchFlagged as undefined, matching buildSvarTasks', () => {
    const current = customOf({ stretchFlagged: true });
    expect(current.stretchFlagged).toBe(true);

    const patch = echoTaskPatch(geometryPayload([], false), current);

    expect((patch as { custom: SvarTask['custom'] }).custom.stretchFlagged).toBeUndefined();
  });

  const occupiedDays = (...days: string[]): CalendarOccupancy[] =>
    days.map((d) => ({
      family: 'recurring-instance',
      itemId: makeCalendarItemId('recurring-instance', 'a.md', d),
      day: d,
      minutes: null,
      stateClass: 'completed',
    }));

  it('drops the derived-occupancy marks on a geometry echo: the echoed span is executor-owned, never the envelope', () => {
    const current = customOf({
      occupancy: occupiedDays('2026-01-02', '2026-01-10'),
      plainBarSuppressed: true,
    });
    expect(hasDerivedBarGeometry(current)).toBe(true);

    const patch = echoTaskPatch(geometryPayload([]), current);

    const custom = (patch as { custom: SvarTask['custom'] }).custom;
    expect(custom.occupancyRuns).toBeUndefined();
    expect(custom.occupancyEnvelope).toBeUndefined();
    // The strip removes exactly what the derived-geometry guard keys on, so
    // the cascade snapshot overlay trusts the echoed span on a stacked move.
    expect(hasDerivedBarGeometry(custom)).toBe(false);
    // Everything else in the row's custom record rides along untouched.
    expect(custom).toMatchObject({ ...current, occupancyRuns: undefined, occupancyEnvelope: undefined });
  });

  it('keeps the derived-occupancy marks on a progress echo: only a geometry write disowns the envelope', () => {
    const current = customOf({ occupancy: occupiedDays('2026-01-02'), plainBarSuppressed: true });

    const patch = echoTaskPatch({ kind: 'progress', progress: 40 }, current);

    // A progress-only patch carries no custom record, so the store's — marks
    // included — stays exactly as it was.
    expect(patch).toEqual({ progress: 40 });
    expect(hasDerivedBarGeometry(current)).toBe(true);
  });
});
