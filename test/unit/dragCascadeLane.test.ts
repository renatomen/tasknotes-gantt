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
});

describe('supersession inherits origin (the per-source before stash)', () => {
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
  function movePass(args: MovePassArgs): CascadePass<PlannerInstance[]> {
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
      snapshot: () => instances,
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
});
