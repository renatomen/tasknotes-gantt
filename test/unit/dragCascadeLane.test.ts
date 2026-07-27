/**
 * The cascade-lane primitive, driven directly through runCascade over real
 * queue/lifecycle/clock collaborators: the declare→fence→re-plan protocol,
 * the after-subtree resume report, the prompt seam, per-source revert
 * isolation with phase reporting, and the between-round capability gate.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  createCascadeLane,
  createGeometryClock,
  type CascadeAnswers,
  type CascadeExecution,
  type CascadePass,
  type CascadePhase,
} from '../../src/bases/dragCascadeLane';
import { createExecutionLifecycle } from '../../src/bases/dragExecutionLifecycle';
import { createSourceQueues } from '../../src/bases/dragSourceQueues';
import { planCascade } from '../../src/bases/dragCommitPlanner';
import type {
  CascadeBefore,
  GestureSettlement,
  PlannedWrite,
  PlannerDerivation,
  PlannerInstance,
} from '../../src/bases/dragCommitPlan';
import {
  inclusiveDaySpan,
  minutesToSpanDays,
  spanDaysToMinutes,
} from '../../src/controller/durationConversion';
import type { PromptAnswer } from '../../src/bases/dragExecutor';
import { cascadePlanOf, deferred, harness, revertOf, writeOf, type Harness } from './dragExecutorTestKit';

function laneOf(h: Harness) {
  const queues = createSourceQueues();
  const clock = createGeometryClock();
  const lifecycle = createExecutionLifecycle(h.deps, clock.recordSettledGeometry);
  return { lane: createCascadeLane({ deps: h.deps, lifecycle, queues, clock }), clock };
}

function passOf(cascade: CascadeExecution): CascadePass<undefined> {
  return {
    cascade,
    settlement: { kind: 'plain' },
    sourcePath: 'a.md',
    snapshot: () => undefined,
    generation: 0,
  };
}

describe('createCascadeLane', () => {
  it('drives the cascade from the settled gesture through the lane: a write-carrying round plans twice, declare then post-fence', async () => {
    const h = harness();
    const { lane } = laneOf(h);
    const seen: GestureSettlement[] = [];

    await lane.runCascade(
      passOf({
        plan: (settlement) => {
          seen.push(settlement);
          return cascadePlanOf({ writes: [writeOf('kid.md', 2)] });
        },
      }),
    );

    expect(seen).toEqual([{ kind: 'plain' }, { kind: 'plain' }]);
    expect(h.log).toEqual(['persist:kid.md']);
  });

  it('honors the after-subtree resume: reports ONLY the persisted writes and re-plans', async () => {
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        return write.sourcePath === 'bad.md'
          ? Promise.reject(new Error('save failed'))
          : Promise.resolve();
      },
    });
    const { lane } = laneOf(h);
    const rounds: CascadeAnswers[] = [];
    const failures: CascadePhase[] = [];

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) => {
          rounds.push(answers);
          if (answers.persistedSubtreeWrites === undefined) {
            return cascadePlanOf({
              resume: 'after-subtree',
              writes: [writeOf('good.md', 2), writeOf('bad.md', 3)],
              reverts: [revertOf('good.md'), revertOf('bad.md')],
            });
          }
          return cascadePlanOf({});
        },
        onFailure: (_error, phase) => failures.push(phase),
      }),
    );

    // Round 1 plans twice (declare + post-fence); round 2 gets the report.
    // A progress write carries no span, so the persisted report has no range.
    expect(rounds).toEqual([{}, {}, { persistedSubtreeWrites: [{ sourcePath: 'good.md' }] }]);
    // Only the FAILED source's reverts were emitted; the good one stayed put.
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['bad.md']);
    expect(failures).toEqual(['subtree']);
  });

  it('collects a shrink-fit answer through the prompt seam and feeds it to the next round', async () => {
    const resolvePrompt = jest.fn(() =>
      Promise.resolve<PromptAnswer | null>({ kind: 'shrink-fit', choice: 'undo' }),
    );
    const h = harness({ resolvePrompt });
    const { lane } = laneOf(h);
    const rounds: CascadeAnswers[] = [];

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) => {
          rounds.push(answers);
          if (answers.shrinkChoice === undefined) {
            return cascadePlanOf({
              prompt: {
                kind: 'shrink-fit',
                name: 'Parent',
                attempted: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 2) },
                fit: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 5) },
              },
            });
          }
          return cascadePlanOf({ writes: [writeOf('a.md', 2)] });
        },
      }),
    );

    expect(rounds).toEqual([{}, { shrinkChoice: 'undo' }, { shrinkChoice: 'undo' }]);
    expect(resolvePrompt).toHaveBeenCalledTimes(1);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:a.md']);
  });

  it('reports a failed extend write with the extend phase and no reverts (refresh-only)', async () => {
    const failures: CascadePhase[] = [];
    const h = harness({
      persist: (write) =>
        write.unmirrored ? Promise.reject(new Error('save failed')) : Promise.resolve(),
    });
    const { lane } = laneOf(h);

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) =>
          answers.extendApproved === undefined
            ? cascadePlanOf({
                writes: [
                  {
                    sourcePath: 'ancestor.md',
                    instanceId: 'ancestor.md#0',
                    patch: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 9) },
                    unmirrored: 'ancestor-extend-refresh-only',
                  },
                ],
              })
            : cascadePlanOf({}),
        onFailure: (_error, phase) => failures.push(phase),
      }),
    );

    expect(failures).toEqual(['extend']);
    expect(h.echoed).toHaveLength(0);
  });

  it('stops the cascade between rounds when write capability is lost', async () => {
    let writable = true;
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        // e.g. the view flips read-only during the subtree round
        if (write.sourcePath === 'kid.md') writable = false;
        return Promise.resolve();
      },
    });
    const { lane } = laneOf(h);
    const rounds: CascadeAnswers[] = [];

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return cascadePlanOf({
            resume: 'after-subtree',
            writes: [writeOf('kid.md', 2)],
          });
        },
      }),
    );

    // Round 1 planned (declare + post-fence) and wrote; the per-round gate
    // stopped round 2 outright.
    expect(rounds).toEqual([{}, {}]);
    expect(h.log).toEqual(['persist:kid.md']);
  });

  it('re-checks capability before EVERY write in a round: a mid-loop loss halts like supersession, reverting ALL the round echoes', async () => {
    let writable = true;
    const failures: CascadePhase[] = [];
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        // the first descendant's persist settles and the host sheds its writer
        if (write.sourcePath === 'kid1.md') writable = false;
        return Promise.resolve();
      },
    });
    const { lane } = laneOf(h);
    const rounds: CascadeAnswers[] = [];

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return cascadePlanOf({
            resume: 'after-subtree',
            writes: [writeOf('kid1.md', 2), writeOf('kid2.md', 3), writeOf('kid3.md', 4)],
            reverts: [revertOf('kid1.md'), revertOf('kid2.md'), revertOf('kid3.md')],
          });
        },
        onFailure: (_error, phase) => failures.push(phase),
      }),
    );

    // Exactly one write landed; the per-write gate stopped kid2/kid3 cold.
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:kid1.md']);
    // ALL the round's echoes reverted, the landed write's included: capability
    // can return, and the successor drag re-plans every child from the stashed
    // origin — a kept landed echo would double-shift under its cumulative delta.
    expect(h.echoed.map((echoes) => echoes.sourcePath)).toEqual(['kid1.md', 'kid2.md', 'kid3.md']);
    // Silent halt: no failure report, no resume report round.
    expect(failures).toEqual([]);
    expect(rounds).toEqual([{}, {}]);
  });

  it('re-checks supersession before EVERY write in a round: a newer settled geometry write stops after the landed write, reverts ALL the round echoes, and halts silently', async () => {
    const failures: CascadePhase[] = [];
    const h = harness();
    const { lane, clock } = laneOf(h);
    h.deps.persist = (write) => {
      h.log.push(`persist:${write.sourcePath}`);
      // A second drag of the SAME source settles its main geometry write while
      // the first descendant's persist is in flight (the parent's source queue
      // is not fenced by this round, which writes only the kids).
      if (write.sourcePath === 'kid1.md') {
        clock.recordSettledGeometry({
          sourcePath: 'a.md',
          instanceId: 'a.md',
          patch: { start: new Date(2026, 0, 8), end: new Date(2026, 0, 9) },
        });
      }
      return Promise.resolve();
    };
    const rounds: CascadeAnswers[] = [];

    await lane.runCascade(
      passOf({
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return cascadePlanOf({
            resume: 'after-subtree',
            writes: [writeOf('kid1.md', 2), writeOf('kid2.md', 3), writeOf('kid3.md', 4)],
            reverts: [revertOf('kid1.md'), revertOf('kid2.md'), revertOf('kid3.md')],
          });
        },
        onFailure: (_error, phase) => failures.push(phase),
      }),
    );

    // Exactly one write landed; the per-write supersession gate stopped the rest.
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:kid1.md']);
    // ALL the round's echoes reverted — the landed write's too: the fenced
    // successor re-plans every one of them from the stashed origin.
    expect(h.echoed.map((echoes) => echoes.sourcePath)).toEqual(['kid1.md', 'kid2.md', 'kid3.md']);
    // Silent halt: no failure report, no resume report round.
    expect(failures).toEqual([]);
    expect(rounds).toEqual([{}, {}]);
  });
});

describe('pre-delivery halts inherit origin (the per-source before stash)', () => {
  const day = (iso: string): Date => new Date(`${iso}T00:00:00`);
  const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999`);
  const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const PARENT = 'notes/T.md';
  const CHILD = 'notes/C1.md';
  const instances: PlannerInstance[] = [
    { id: PARENT, sourcePath: PARENT, text: 'T', start: day('2026-08-03'), end: dayEnd('2026-08-06') },
    { id: CHILD, sourcePath: CHILD, text: 'C1', parent: PARENT, start: day('2026-08-03'), end: dayEnd('2026-08-04') },
  ];
  const deriv: PlannerDerivation = { minutesToSpanDays, spanDaysToMinutes, inclusiveDaySpan };
  const span = (start: Date, end: Date) => ({ start, end });
  const B0 = span(day('2026-08-03'), dayEnd('2026-08-06'));
  const A1 = span(addDays(B0.start, 3), addDays(B0.end, 3)); // first move: +3
  const A2 = span(addDays(B0.start, 7), addDays(B0.end, 7)); // second move: +4 more
  const A3 = span(addDays(B0.start, 9), addDays(B0.end, 9)); // third move: +2 more

  interface MovePassArgs {
    before: { start: Date; end: Date };
    after: { start: Date; end: Date };
    settlement?: GestureSettlement;
    seen?: (before: CascadeBefore | undefined) => void;
  }

  /** A real-planner pure-move cascade pass, planning from the lane's effective before. */
  function movePass(args: MovePassArgs, snapshot: PlannerInstance[] = instances): CascadePass<PlannerInstance[]> {
    const own: CascadeBefore = { ...args.before, estimateMinutes: null };
    return {
      cascade: {
        before: own,
        plan: (settlement, answers, facts, before) => {
          args.seen?.(before);
          return planCascade(
            { instanceId: PARENT, name: 'T', before: before ?? own, after: args.after, settlement },
            facts,
            { cascadeMode: 'auto', ...answers },
            deriv,
          );
        },
      },
      settlement: args.settlement ?? { kind: 'plain' },
      sourcePath: PARENT,
      snapshot: () => snapshot,
      generation: 0,
    };
  }

  /** A harness whose 'block.md' persist parks the lane until released. */
  function blockableHarness() {
    const writes: PlannedWrite[] = [];
    const blocker = deferred();
    const h = harness({
      persist: (write) => {
        if (write.sourcePath === 'block.md') return blocker.promise;
        writes.push(write);
        return Promise.resolve();
      },
    });
    return { h, writes, blocker };
  }

  function blockPass(): CascadePass<undefined> {
    return {
      cascade: { plan: () => cascadePlanOf({ writes: [writeOf('block.md', 1)] }) },
      settlement: { kind: 'plain' },
      sourcePath: 'block.md',
      snapshot: () => undefined,
      generation: 0,
    };
  }

  /** Cascade 1 (+3) parks behind the lane, drag 2 settles → cascade 1 is superseded. */
  async function supersedeFirstMove(laneKit: ReturnType<typeof laneOf>, blocker: ReturnType<typeof deferred>) {
    const blocked = laneKit.lane.runCascade(blockPass());
    const first = laneKit.lane.runCascade(movePass({ before: B0, after: A1 }));
    // The second drag's main geometry write settles while cascade 1 waits.
    laneKit.clock.recordSettledGeometry({
      sourcePath: PARENT,
      instanceId: PARENT,
      patch: { start: A2.start, end: A2.end },
    });
    blocker.resolve();
    await blocked;
    await first;
  }

  it('a superseded +3 move hands its origin to the +4 successor: the children shift +7 in ONE cascade', async () => {
    const { h, writes, blocker } = blockableHarness();
    const laneKit = laneOf(h);
    await supersedeFirstMove(laneKit, blocker);
    expect(writes.filter((w) => w.sourcePath === CHILD)).toHaveLength(0); // cascade 1 never wrote

    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, seen: (b) => seen.push(b) }));

    // The successor planned from the STASHED origin (B0), not its own before (A1)…
    expect(seen[0]).toEqual({ ...B0, estimateMinutes: null });
    // …so one subtree move carries the full +7: the child lands at its original span +7.
    const childWrites = writes.filter((w) => w.sourcePath === CHILD);
    expect(childWrites).toHaveLength(1);
    expect(childWrites[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 7));
    expect(childWrites[0]?.patch.end).toEqual(addDays(dayEnd('2026-08-04'), 7));
  });

  it('a completed cascade clears the stash: the third drag shifts only its own delta', async () => {
    const { h, writes, blocker } = blockableHarness();
    const laneKit = laneOf(h);
    await supersedeFirstMove(laneKit, blocker);
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2 })); // delivers +7, settles the account

    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A2, after: A3, seen: (b) => seen.push(b) }));

    // The third cascade planned from its OWN before (A2): the stash was cleared.
    expect(seen[0]).toEqual({ ...A2, estimateMinutes: null });
    const childWrites = writes.filter((w) => w.sourcePath === CHILD);
    expect(childWrites).toHaveLength(2);
    // The third shift is +2 over the (static test) snapshot — never B0's +9.
    expect(childWrites[1]?.patch.start).toEqual(addDays(day('2026-08-03'), 2));
  });

  it('an aborted pass neither consumes a pending stash nor resurrects a settled one', async () => {
    const { h, writes, blocker } = blockableHarness();
    const laneKit = laneOf(h);
    await supersedeFirstMove(laneKit, blocker);

    // An aborted gesture's pass (empty plan) runs while B0 is owed: it must not clear it.
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, settlement: { kind: 'aborted' } }));
    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, seen: (b) => seen.push(b) }));
    expect(seen[0]).toEqual({ ...B0, estimateMinutes: null }); // the stash survived the aborted pass
    expect(writes.filter((w) => w.sourcePath === CHILD)).toHaveLength(1);

    // The account is settled now; another aborted pass must not resurrect B0.
    await laneKit.lane.runCascade(movePass({ before: A2, after: A3, settlement: { kind: 'aborted' } }));
    const seenAfter: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A2, after: A3, seen: (b) => seenAfter.push(b) }));
    expect(seenAfter[0]).toEqual({ ...A2, estimateMinutes: null });
  });

  it('a capability drop before the cascade starts stashes the origin: after capability returns, the next drag displaces the subtree by BOTH moves', async () => {
    let writable = false; // the host sheds its writer right after the main persist
    const writes: PlannedWrite[] = [];
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    });
    const laneKit = laneOf(h);
    await laneKit.lane.runCascade(movePass({ before: B0, after: A1 }));
    expect(writes).toHaveLength(0); // the halted pass never cascaded

    writable = true; // capability returns; the parent is dragged again
    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, seen: (b) => seen.push(b) }));

    // The successor planned from the STASHED origin (B0), not its own A1…
    expect(seen[0]).toEqual({ ...B0, estimateMinutes: null });
    // …so the child receives the FULL A→C displacement in one move (+7).
    const childWrites = writes.filter((w) => w.sourcePath === CHILD);
    expect(childWrites).toHaveLength(1);
    expect(childWrites[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 7));
    expect(childWrites[0]?.patch.end).toEqual(addDays(dayEnd('2026-08-04'), 7));
  });

  it('a mid-round capability loss stashes the origin: capability returns, the next drag covers landed AND skipped children with the cumulative shift', async () => {
    const CHILD2 = 'notes/C2.md';
    const twoKids: PlannerInstance[] = [
      ...instances,
      { id: CHILD2, sourcePath: CHILD2, text: 'C2', parent: PARENT, start: day('2026-08-05'), end: dayEnd('2026-08-06') },
    ];
    let writable = true;
    const writes: PlannedWrite[] = [];
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        writes.push(write);
        // The first child's persist settles and the host sheds its writer.
        if (writes.length === 1) writable = false;
        return Promise.resolve();
      },
    });
    const laneKit = laneOf(h);
    await laneKit.lane.runCascade(movePass({ before: B0, after: A1 }, twoKids));
    // One child landed (+3); the per-write capability gate halted the round —
    // the partial delivery must NOT settle the origin account.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 3));

    writable = true; // capability returns; the parent is dragged again
    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, seen: (b) => seen.push(b) }, twoKids));

    // The successor inherited B0 and re-planned BOTH children from it: the
    // landed child is overwritten to the cumulative +7 (never double-shifted),
    // and the SKIPPED child receives the displacement it was owed.
    expect(seen[0]).toEqual({ ...B0, estimateMinutes: null });
    const successorWrites = writes.slice(1).filter((w) => w.sourcePath === CHILD || w.sourcePath === CHILD2);
    expect(successorWrites.map((w) => [w.sourcePath, w.patch.start])).toEqual([
      [CHILD, addDays(day('2026-08-03'), 7)],
      [CHILD2, addDays(day('2026-08-05'), 7)],
    ]);
  });

  it('a halted resize creates no origin debt: the later pure move shifts children by ITS OWN full delta, not zero', async () => {
    // The container opts a resize out of origin inheritance (pureMoveBefore →
    // absent `before`). Halt one while a move stash would otherwise form, then
    // pure-move: the children must follow the move's delta.
    const resized = span(B0.start, addDays(B0.end, 2)); // end-edge resize, +2 days
    let writable = false; // the host sheds its writer right after the resize's main persist
    const writes: PlannedWrite[] = [];
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    });
    const laneKit = laneOf(h);
    const resizePass = movePass({ before: B0, after: resized });
    resizePass.cascade.before = undefined; // what pureMoveBefore hands a resize
    await laneKit.lane.runCascade(resizePass);
    expect(writes).toHaveLength(0);

    writable = true; // capability returns; the user pure-moves the parent +3
    const moved = span(addDays(resized.start, 3), addDays(resized.end, 3));
    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: resized, after: moved, seen: (b) => seen.push(b) }));

    // No stale pre-resize shape was stashed: the move plans from its own
    // before, and the child follows the move's full +3.
    expect(seen[0]).toEqual({ ...resized, estimateMinutes: null });
    const childWrites = writes.filter((w) => w.sourcePath === CHILD);
    expect(childWrites).toHaveLength(1);
    expect(childWrites[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 3));
    expect(childWrites[0]?.patch.end).toEqual(addDays(dayEnd('2026-08-04'), 3));
  });

  it('an inherited origin is re-shaped to the successor\'s own span length: an interleaved resize cannot zero the owed move', async () => {
    // Move +3 halts (stash B0). A resize then lands the parent 2 days longer.
    // The next pure move (+4) must still read as a MOVE against the stash —
    // the origin adopts the successor's shape at the stashed start.
    let writable = false;
    const writes: PlannedWrite[] = [];
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    });
    const laneKit = laneOf(h);
    await laneKit.lane.runCascade(movePass({ before: B0, after: A1 }));
    expect(writes).toHaveLength(0); // +3 halted; B0 stashed

    writable = true;
    // The successor pure-moves the (meanwhile resized, +2-days-longer) parent by +4.
    const resizedA1 = span(A1.start, addDays(A1.end, 2));
    const resizedA2 = span(addDays(resizedA1.start, 4), addDays(resizedA1.end, 4));
    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(
      movePass({ before: resizedA1, after: resizedA2, seen: (b) => seen.push(b) }),
    );

    // The effective origin sits at B0's start with the successor's OWN length…
    expect(seen[0]).toEqual({ start: B0.start, end: addDays(B0.end, 2), estimateMinutes: null });
    // …so the move delta stays well-defined and the child shifts the full +7.
    const childWrites = writes.filter((w) => w.sourcePath === CHILD);
    expect(childWrites).toHaveLength(1);
    expect(childWrites[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 7));
  });

  it('a mid-round supersession stashes the origin: the successor re-plans the landed child too, so every child lands at the cumulative displacement', async () => {
    const CHILD2 = 'notes/C2.md';
    const twoKids: PlannerInstance[] = [
      ...instances,
      { id: CHILD2, sourcePath: CHILD2, text: 'C2', parent: PARENT, start: day('2026-08-05'), end: dayEnd('2026-08-06') },
    ];
    const writes: PlannedWrite[] = [];
    const h = harness();
    const laneKit = laneOf(h);
    h.deps.persist = (write) => {
      writes.push(write);
      // The second drag's main geometry write settles while the FIRST child's
      // persist is in flight (the parent's source is not fenced by this round).
      if (writes.length === 1) {
        laneKit.clock.recordSettledGeometry({
          sourcePath: PARENT,
          instanceId: PARENT,
          patch: { start: A2.start, end: A2.end },
        });
      }
      return Promise.resolve();
    };
    await laneKit.lane.runCascade(movePass({ before: B0, after: A1 }, twoKids));
    // Exactly one child landed (+3) before the per-write gate halted the round.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.patch.start).toEqual(addDays(day('2026-08-03'), 3));

    const seen: Array<CascadeBefore | undefined> = [];
    await laneKit.lane.runCascade(movePass({ before: A1, after: A2, seen: (b) => seen.push(b) }, twoKids));

    // The successor inherited B0 and re-planned BOTH children from it: the
    // landed child is overwritten to the cumulative +7 (never double-shifted),
    // and the halted child receives the same +7 it was owed.
    expect(seen[0]).toEqual({ ...B0, estimateMinutes: null });
    const successorWrites = writes.slice(1).filter((w) => w.sourcePath === CHILD || w.sourcePath === CHILD2);
    expect(successorWrites.map((w) => [w.sourcePath, w.patch.start])).toEqual([
      [CHILD, addDays(day('2026-08-03'), 7)],
      [CHILD2, addDays(day('2026-08-05'), 7)],
    ]);
  });
});
