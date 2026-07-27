/**
 * The COMPOSED executor's end-to-end choreography — orderings only the wired
 * queue/lifecycle/lane trio exhibits: per-source serialization with
 * dequeue-time re-planning, cross-source cascade fencing, deadlock-free
 * opposing cascades, generation capture at submit, and the round-5 rows
 * (supersession, post-fence capability re-check, the liveness split, the
 * persisted-span resume report). Each primitive's own policy is pinned in its
 * module suite (dragSourceQueues / dragExecutionLifecycle / dragCascadeLane).
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  createDragExecutor,
  type CascadeAnswers,
  type CascadePhase,
  type PromptAnswer,
} from '../../src/bases/dragExecutor';
import { createDequeueBeforeRebase } from '../../src/bases/dragDequeueRebase';
import {
  type BarBefore,
  type GestureChoice,
  type GesturePlan,
  type GestureSettlement,
  type PlannerDerivation,
  type PlannerInstance,
} from '../../src/bases/dragCommitPlan';
import { planGestureCommit } from '../../src/bases/dragCommitPlanner';
import {
  inclusiveDaySpan,
  minutesToSpanDays,
  spanDaysToMinutes,
} from '../../src/controller/durationConversion';
import {
  cascadePlanOf,
  deferred,
  execution,
  flushMicrotasks,
  harness,
  planOf,
  revertOf,
  writeOf,
  type Harness,
} from './dragExecutorTestKit';

describe('createDragExecutor', () => {
  it('queues a second gesture for the same source and re-plans it at dequeue from post-settlement facts', async () => {
    const gate = deferred();
    const facts = { progress: 10 };
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.patch.progress}`);
        return gate.promise.then(() => {
          facts.progress = 50;
        });
      },
    });
    const executor = createDragExecutor(h.deps);
    const planSecond = jest.fn(() => planOf({ writes: [writeOf('a.md', facts.progress)] }));

    const first = executor.submit(execution('a.md', () => planOf({ writes: [writeOf('a.md', 10)] })));
    const second = executor.submit(execution('a.md', planSecond));
    await Promise.resolve();

    expect(planSecond).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
    expect(planSecond).toHaveBeenCalledTimes(1);
    expect(h.log).toEqual(['persist:10', 'persist:50']);
    expect(h.settled).toEqual([{ kind: 'plain' }, { kind: 'plain' }]);
  });

  it('snapshots at dequeue: the queued gesture plans from the FIRST gesture\'s settled write, ONE capture spans its prompt re-plan, and the cascade round re-captures afresh', async () => {
    const gate = deferred();
    const store = { progress: 10 };
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.patch.progress}`);
        if (write.patch.progress === 10) {
          return gate.promise.then(() => {
            store.progress = 50; // the first gesture's write settles into the facts
          });
        }
        return Promise.resolve();
      },
      resolvePrompt: () =>
        Promise.resolve<PromptAnswer | null>({
          kind: 'inferred-drag',
          choice: { action: 'estimate-and-dates' },
        }),
    });
    const executor = createDragExecutor(h.deps);
    const snapshot = jest.fn(() => ({ progress: store.progress }));
    const captures: Array<{ progress: number }> = [];

    const first = executor.submit(execution('a.md', () => planOf({ writes: [writeOf('a.md', 10)] })));
    const second = executor.submit({
      sourcePath: 'a.md',
      snapshot,
      plan: (choice, facts) => {
        captures.push(facts);
        return choice === undefined
          ? planOf({ prompt: { kind: 'inferred-drag' } })
          : planOf({ writes: [writeOf('a.md', facts.progress)] });
      },
      cascade: {
        plan: (_settlement, _answers, facts) => {
          captures.push(facts);
          return cascadePlanOf({});
        },
      },
    });
    await Promise.resolve();

    expect(snapshot).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
    // Plan + prompt re-plan share the ONE dequeue capture; the cascade round
    // captures afresh inside the lane (a second snapshot call, same facts here).
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(captures).toHaveLength(3);
    expect(captures[0]).toEqual({ progress: 50 });
    expect(captures[1]).toBe(captures[0]);
    expect(captures[2]).not.toBe(captures[0]);
    expect(captures[2]).toEqual({ progress: 50 });
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual([
      'persist:10',
      'persist:50',
    ]);
  });

  /** The container's bar-gesture wiring in miniature: real planner, live-row
   *  reads through the dequeue rebase, echoes landing back on the store. */
  function barGestureKit() {
    const spanOf = (startDay: number, endDay: number) => ({
      start: new Date(2026, 0, startDay),
      end: new Date(2026, 0, endDay, 23, 59, 59),
    });
    const [spanA, spanB, spanC] = [spanOf(1, 2), spanOf(3, 4), spanOf(5, 6)];
    // The live SVAR row: every emitted echo (optimistic or revert) lands here.
    const store = { span: { ...spanA } };
    const derivation: PlannerDerivation = { minutesToSpanDays, spanDaysToMinutes, inclusiveDaySpan };
    const beforeOf = (span: { start: Date; end: Date }): BarBefore => ({
      ...span,
      dateStatus: null,
      estimateMinutes: null,
    });
    const barPlan = (
      before: BarBefore,
      after: { start: Date; end: Date },
      snapshot: PlannerInstance[],
      choice: GestureChoice,
    ) =>
      planGestureCommit(
        { kind: 'bar', instanceId: 'a.md#0', before, after, estimateWritable: false, inferredDragMode: 'estimate-and-dates' },
        snapshot,
        choice,
        derivation,
      );
    const rowOf = (): PlannerInstance[] => [{ id: 'a.md#0', sourcePath: 'a.md', text: 'T', ...store.span }];
    const applyEchoToStore = (h: ReturnType<typeof harness>) => (echoes: Parameters<typeof h.deps.echo>[0]) => {
      h.echoed.push(echoes);
      const payload = echoes.rows[0]?.payload;
      if (payload?.kind === 'geometry') {
        store.span = { start: payload.geometry.start, end: payload.geometry.end };
      }
    };
    return { spanA, spanB, spanC, store, beforeOf, barPlan, rowOf, applyEchoToStore };
  }

  it("rebases a queued gesture's `before` at dequeue: the predecessor's failed write reverts the row to A, so B→C plans the real A→C write with reverts baselined at A", async () => {
    const kit = barGestureKit();
    const { spanA, spanB, spanC, store, beforeOf, barPlan, rowOf } = kit;
    const gate = deferred();
    const h: Harness = harness({
      persist: (write) => {
        h.log.push(`persist:${write.patch.start?.getDate()}-${write.patch.end?.getDate()}`);
        return write.patch.start === spanB.start
          ? gate.promise.then(() => Promise.reject(new Error('save failed')))
          : Promise.resolve();
      },
      echo: (echoes) => kit.applyEchoToStore(h)(echoes),
    });
    const executor = createDragExecutor(h.deps);

    const first = executor.submit({
      sourcePath: 'a.md',
      snapshot: rowOf,
      plan: (choice, snapshot) => barPlan(beforeOf(spanA), spanB, snapshot, choice),
    });
    await flushMicrotasks(); // A→B echoed optimistically; its persist is in flight
    store.span = { ...spanC }; // the user drags the echoed bar B→C; SVAR applies it
    const rebase = createDequeueBeforeRebase({ gestureBefore: beforeOf(spanB), after: spanC, readLive: () => beforeOf(store.span) });
    let queuedPlan: GesturePlan | null = null;
    const second = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => {
        rebase.atDequeue();
        return rowOf();
      },
      plan: (choice, snapshot) => {
        queuedPlan = barPlan(rebase.before(), spanC, snapshot, choice);
        return queuedPlan;
      },
    });
    gate.resolve(); // the first write fails; its revert echoes the row back to A
    await Promise.all([first, second]);

    // The queued gesture planned the FULL A→C write — a real write off the
    // reverted row, not the stale gesture-time B — and it landed.
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:3-4', 'persist:5-6']);
    expect(queuedPlan?.writes[0]?.patch).toEqual({ start: spanC.start, end: spanC.end });
    // Its revert baseline is A, where the row really sat at dequeue.
    expect(queuedPlan?.reverts[0]?.rows[0]?.payload).toEqual({
      kind: 'geometry',
      geometry: { ...spanA, flagged: false, ghostRuns: [] },
    });
    expect(h.settled).toEqual([{ kind: 'aborted' }, { kind: 'plain' }]);
  });

  it("classifies a queued B→A behind a failing A→B as a no-op: the predecessor's revert to A is not this gesture's own optimistic position", async () => {
    const kit = barGestureKit();
    const { spanA, spanB, store, beforeOf, barPlan, rowOf } = kit;
    const gate = deferred();
    const h: Harness = harness({
      persist: (write) => {
        h.log.push(`persist:${write.patch.start?.getDate()}-${write.patch.end?.getDate()}`);
        return write.patch.start === spanB.start
          ? gate.promise.then(() => Promise.reject(new Error('save failed')))
          : Promise.resolve();
      },
      echo: (echoes) => kit.applyEchoToStore(h)(echoes),
    });
    const executor = createDragExecutor(h.deps);

    const first = executor.submit({
      sourcePath: 'a.md',
      snapshot: rowOf,
      plan: (choice, snapshot) => barPlan(beforeOf(spanA), spanB, snapshot, choice),
    });
    await flushMicrotasks(); // A→B echoed optimistically; its persist is in flight
    // The user drags the echoed bar straight back B→A; SVAR applies it. The
    // gesture's own `after` now EQUALS where the predecessor's revert will put
    // the row — span equality alone cannot tell those apart.
    const echoSeqAtCapture = executor.echoSeqOf('a.md');
    store.span = { ...spanA };
    const rebase = createDequeueBeforeRebase({
      gestureBefore: beforeOf(spanB),
      after: spanA,
      readLive: () => beforeOf(store.span),
      movedByPredecessor: () => executor.echoSeqOf('a.md') !== echoSeqAtCapture,
    });
    let queuedPlan: GesturePlan | null = null;
    const second = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => {
        rebase.atDequeue();
        return rowOf();
      },
      plan: (choice, snapshot) => {
        queuedPlan = barPlan(rebase.before(), spanA, snapshot, choice);
        return queuedPlan;
      },
    });
    gate.resolve(); // the first write fails; its revert echoes the row back to A
    await Promise.all([first, second]);

    // The rebase trusted the live row (vault truth A), so the queued gesture is
    // a no-op — no write, and no stale B-baselined revert waiting to misfire.
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:3-4']);
    expect(queuedPlan?.writes).toEqual([]);
    expect(queuedPlan?.reverts).toEqual([]);
    expect(h.settled).toEqual([{ kind: 'aborted' }, { kind: 'no-cascade' }]);
  });

  it("keeps a queued gesture's `before` when the predecessor SUCCEEDED: the row still holds this gesture's own drag, so B→C stays B→C", async () => {
    const kit = barGestureKit();
    const { spanA, spanB, spanC, store, beforeOf, barPlan, rowOf } = kit;
    const gate = deferred();
    const h: Harness = harness({
      persist: (write) => {
        h.log.push(`persist:${write.patch.start?.getDate()}-${write.patch.end?.getDate()}`);
        return write.patch.start === spanB.start ? gate.promise : Promise.resolve();
      },
      echo: (echoes) => kit.applyEchoToStore(h)(echoes),
    });
    const executor = createDragExecutor(h.deps);

    const first = executor.submit({
      sourcePath: 'a.md',
      snapshot: rowOf,
      plan: (choice, snapshot) => barPlan(beforeOf(spanA), spanB, snapshot, choice),
    });
    await flushMicrotasks();
    store.span = { ...spanC }; // the user drags the echoed bar B→C; SVAR applies it
    const rebase = createDequeueBeforeRebase({ gestureBefore: beforeOf(spanB), after: spanC, readLive: () => beforeOf(store.span) });
    let queuedPlan: GesturePlan | null = null;
    const second = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => {
        rebase.atDequeue();
        return rowOf();
      },
      plan: (choice, snapshot) => {
        queuedPlan = barPlan(rebase.before(), spanC, snapshot, choice);
        return queuedPlan;
      },
    });
    gate.resolve(); // the first write settles; no revert touches the row
    await Promise.all([first, second]);

    // The row still shows this gesture's own post-drag span, so the capture
    // stands: B→C writes C with reverts baselined at B.
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:3-4', 'persist:5-6']);
    expect(queuedPlan?.writes[0]?.patch).toEqual({ start: spanC.start, end: spanC.end });
    expect(queuedPlan?.reverts[0]?.rows[0]?.payload).toEqual({
      kind: 'geometry',
      geometry: { ...spanB, flagged: false, ghostRuns: [] },
    });
    expect(h.settled).toEqual([{ kind: 'plain' }, { kind: 'plain' }]);
  });

  it('rebases a queued gesture over the SETTLED authored facts: resize 2→4 then back to 2 writes the estimate back down, not against the pre-first-write row', async () => {
    const kit = barGestureKit();
    const { store, rowOf } = kit;
    const span2 = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 2, 23, 59, 59) };
    const span4 = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 4, 23, 59, 59) };
    store.span = { ...span2 };
    const gate = deferred();
    const persisted: Array<Record<string, unknown>> = [];
    const h: Harness = harness({
      persist: (write) => {
        persisted.push(write.patch as Record<string, unknown>);
        return persisted.length === 1 ? gate.promise : Promise.resolve();
      },
      echo: (echoes) => kit.applyEchoToStore(h)(echoes),
    });
    const executor = createDragExecutor(h.deps);
    // The container's live-facts read: span from the store, authored facts from
    // controller rows FROZEN pre-first-write (self-writes suppress recompute) —
    // rebased over the executor's settled-facts ledger.
    const captureLive = (): BarBefore =>
      executor.rebaseSettledFacts('a.md', {
        ...store.span,
        dateStatus: null,
        estimateMinutes: spanDaysToMinutes(2),
      });
    const estimatePlan = (before: BarBefore, after: { start: Date; end: Date }, snapshot: PlannerInstance[], choice: GestureChoice) =>
      planGestureCommit(
        { kind: 'bar', instanceId: 'a.md#0', before, after, estimateWritable: true, inferredDragMode: 'estimate-and-dates' },
        snapshot,
        choice,
        { minutesToSpanDays, spanDaysToMinutes, inclusiveDaySpan },
      );

    const first = executor.submit({
      sourcePath: 'a.md',
      snapshot: rowOf,
      plan: (choice, snapshot) => estimatePlan(captureLive(), span4, snapshot, choice),
    });
    await flushMicrotasks(); // 2→4 echoed; its persist (dates + 4-day estimate) is in flight
    const before2 = captureLive(); // intercept capture: the echoed 4-day bar, frozen 2-day estimate
    store.span = { ...span2 }; // the user resizes straight back; SVAR applies 4→2
    const rebase = createDequeueBeforeRebase({ gestureBefore: before2, after: span2, readLive: captureLive });
    const second = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => {
        rebase.atDequeue();
        return rowOf();
      },
      plan: (choice, snapshot) => estimatePlan(rebase.before(), span2, snapshot, choice),
    });
    gate.resolve();
    await Promise.all([first, second]);

    // The first gesture wrote the 4-day estimate; the second compared against
    // the SETTLED 4-day fact (not the frozen 2-day row) and wrote it back down.
    expect(persisted[0]?.estimate).toBe(spanDaysToMinutes(4));
    expect(persisted[1]?.estimate).toBe(spanDaysToMinutes(2));
    expect(h.settled).toEqual([{ kind: 'plain' }, { kind: 'plain' }]);
  });

  it('lets gestures on distinct sources proceed independently', async () => {
    const gateA = deferred();
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        return write.sourcePath === 'a.md' ? gateA.promise : Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);

    const a = executor.submit(execution('a.md', () => planOf({ writes: [writeOf('a.md', 1)] })));
    const b = executor.submit(execution('b.md', () => planOf({ writes: [writeOf('b.md', 2)] })));
    await b;

    expect(h.log).toEqual(['persist:a.md', 'persist:b.md']);
    gateA.resolve();
    await a;
    expect(h.settled).toHaveLength(2);
  });

  it('runs only the failing plan reverts and leaves queued work untouched', async () => {
    const failures: unknown[] = [];
    const h = harness({
      persist: (write) =>
        write.sourcePath === 'a.md' ? Promise.reject(new Error('save failed')) : Promise.resolve(),
    });
    const executor = createDragExecutor(h.deps);

    await executor.submit(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error),
      ),
    );
    await executor.submit(
      execution('a.md', () => planOf({ writes: [{ ...writeOf('a.md', 2), sourcePath: 'b.md' }], reverts: [revertOf('b.md')] })),
    );

    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']);
    expect(failures).toHaveLength(1);
    expect(h.settled).toEqual([{ kind: 'aborted' }, { kind: 'plain' }]);
  });

  it('reports a plan-callback throw without breaking the source queue', async () => {
    const failures: unknown[] = [];
    const h = harness();
    const executor = createDragExecutor(h.deps);

    await executor.submit(
      execution(
        'a.md',
        () => {
          throw new Error('plan blew up');
        },
        (error) => failures.push(error),
      ),
    );
    await executor.submit(execution('a.md', () => planOf({ writes: [writeOf('a.md', 1)] })));

    expect(failures).toHaveLength(1);
    expect(h.settled).toEqual([{ kind: 'plain' }]);
  });
});

describe('createDragExecutor cascade pass', () => {
  it('runs no cascade when the gesture prompt is cancelled into an aborted, write-less plan', async () => {
    const resolvePrompt = jest.fn(() =>
      Promise.resolve<PromptAnswer | null>({ kind: 'inferred-drag', choice: null }),
    );
    const h = harness({ resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const cascadeSettlements: GestureSettlement[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: (choice) =>
        choice === undefined
          ? planOf({ prompt: { kind: 'inferred-drag' } })
          : planOf({
              echoes: [revertOf('a.md')],
              settlement: { onSuccess: { kind: 'aborted' }, onFailure: { kind: 'aborted' } },
            }),
      cascade: {
        plan: (settlement) => {
          cascadeSettlements.push(settlement);
          return cascadePlanOf({});
        },
      },
    });

    // The cascade still plans — from the ABORTED settlement — and the planner
    // (faked here as the empty plan) is what guarantees nothing cascades.
    expect(cascadeSettlements).toEqual([{ kind: 'aborted' }]);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual([]);
  });

  it('fences cascade writes: a gesture on a child source queued mid-cascade waits for the cascade and plans from post-cascade facts', async () => {
    const gate = deferred();
    const store = { b: 0 };
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}:${write.patch.progress}`);
        if (write.sourcePath === 'b.md' && write.patch.progress === 2) {
          return gate.promise.then(() => {
            store.b = 2; // the cascade's write to the child settles into the facts
          });
        }
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const seenChildFacts: number[] = [];

    const gestureA = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: () => cascadePlanOf({ writes: [writeOf('b.md', 2)] }),
      },
    });
    await flushMicrotasks(); // the cascade round's write to b.md is now in flight
    const gestureB = executor.submit({
      sourcePath: 'b.md',
      snapshot: () => ({ b: store.b }),
      plan: (_choice, facts) => {
        seenChildFacts.push(facts.b);
        return planOf({ writes: [writeOf('b.md', 100 + facts.b)] });
      },
    });
    await flushMicrotasks();

    // The child gesture joined the cascade's fence: nothing planned yet.
    expect(seenChildFacts).toEqual([]);
    gate.resolve();
    await Promise.all([gestureA, gestureB]);
    expect(seenChildFacts).toEqual([2]);
    expect(h.log).toEqual(['persist:a.md:1', 'persist:b.md:2', 'persist:b.md:102']);
  });

  it('a generation flip after the main persist landed keeps the cascade DATA writes flowing — prompts still collected through the seam, echoes suppressed', async () => {
    let generation = 0;
    const failures: unknown[] = [];
    const cascadeFailures: CascadePhase[] = [];
    const resolvePrompt = jest.fn(() => {
      generation += 1; // the view remounts while the shrink-fit modal is open
      return Promise.resolve<PromptAnswer | null>({ kind: 'shrink-fit', choice: 'adjust' });
    });
    const h = harness({ generation: () => generation, resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      onFailure: (error) => failures.push(error),
      cascade: {
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
          return cascadePlanOf({ writes: [writeOf('a.md', 2)], echoes: [revertOf('a.md')] });
        },
        onFailure: (_error, phase) => cascadeFailures.push(phase),
      },
    });

    // The main persist landed BEFORE the flip, so the vault-side correction
    // must not be dropped: the shrink answer is collected and its write lands.
    expect(rounds).toEqual([{}, { shrinkChoice: 'adjust' }, { shrinkChoice: 'adjust' }]);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual([
      'persist:a.md',
      'persist:a.md',
    ]);
    // ...but the remounted store refreshes from the vault, so no echoes.
    expect(h.echoed).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(cascadeFailures).toHaveLength(0);
  });

  it('never submits into a newer generation: an execution submitted before a remount does not run after it', async () => {
    let generation = 0;
    const plan = jest.fn(() => planOf({ writes: [writeOf('a.md', 1)] }));
    const h = harness({ generation: () => generation });
    const executor = createDragExecutor(h.deps);

    const submitted = executor.submit(execution('a.md', plan));
    generation += 1;
    await submitted;

    expect(plan).not.toHaveBeenCalled();
    expect(h.settled).toHaveLength(0);
  });

  it('completes two OPPOSING cascades without deadlock (A cascades into B\'s source while B cascades into A\'s), and the waiting cascade plans from the facts the first one settled', async () => {
    const gateA = deferred();
    const gateB = deferred();
    const store = { aCascadeLanded: false };
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}:${write.patch.progress}`);
        if (write.patch.progress === 1) return write.sourcePath === 'a.md' ? gateA.promise : gateB.promise;
        if (write.sourcePath === 'b.md') store.aCascadeLanded = true; // A's cascade write settles
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const factsSeenByB: boolean[] = [];

    // Both mains in flight at once; each cascades into the OTHER gesture's source
    // — the exact shape that circular-waited under per-round multi-joins.
    const a = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: { plan: () => cascadePlanOf({ writes: [writeOf('b.md', 2)] }) },
    });
    const b = executor.submit({
      sourcePath: 'b.md',
      snapshot: () => ({ aCascadeLanded: store.aCascadeLanded }),
      plan: () => planOf({ writes: [writeOf('b.md', 1)] }),
      cascade: {
        plan: (_settlement, _answers, facts) => {
          factsSeenByB.push(facts.aCascadeLanded);
          return cascadePlanOf({ writes: [writeOf('a.md', 2)] });
        },
      },
    });
    await flushMicrotasks();
    gateA.resolve();
    gateB.resolve();
    await Promise.all([a, b]);

    // All four persists landed, in a consistent order: both mains first, then
    // the two cascade rounds serialized through the single lane.
    expect(h.log).toEqual([
      'persist:a.md:1',
      'persist:b.md:1',
      'persist:b.md:2',
      'persist:a.md:2',
    ]);
    // B's cascade waited on the lane and re-planned from post-A-cascade facts.
    expect(factsSeenByB).toEqual([true, true]);
  });

  it('reports the persisted subtree write with the exact span it carried', async () => {
    const h = harness();
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];
    const span = { start: new Date(2026, 7, 10), end: new Date(2026, 7, 11) };

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (_settlement, answers) => {
          rounds.push(answers);
          if (answers.persistedSubtreeWrites === undefined) {
            return cascadePlanOf({
              resume: 'after-subtree',
              writes: [{ sourcePath: 'kid.md', instanceId: 'kid.md#0', patch: { ...span } }],
            });
          }
          return cascadePlanOf({});
        },
      },
    });

    // The report carries the write's OWN span — the moved range, so the resume
    // re-plan never re-applies the delta (refresh-independent by construction).
    expect(rounds[2]).toEqual({
      persistedSubtreeWrites: [{ sourcePath: 'kid.md', range: span }],
    });
  });

  it('supersession: a newer settled geometry write for the source skips the deferred cascade cleanly — no writes, prompts, or notices', async () => {
    const modal = deferred();
    const cascadeFailures: CascadePhase[] = [];
    const resolvePrompt = jest.fn(() =>
      modal.promise.then<PromptAnswer | null>(() => ({ kind: 'shrink-fit', choice: 'adjust' })),
    );
    const h = harness({ resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];

    const first = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
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
        onFailure: (_error, phase) => cascadeFailures.push(phase),
      },
    });
    await flushMicrotasks(); // the shrink-fit modal is open, the slot released
    // A second drag on the SAME source settles a geometry write meanwhile.
    const second = executor.submit(
      execution('a.md', () =>
        planOf({
          writes: [{
            sourcePath: 'a.md',
            instanceId: 'a.md#0',
            patch: { start: new Date(2026, 0, 3), end: new Date(2026, 0, 4) },
          }],
        }),
      ),
    );
    await second;
    modal.resolve();
    await first;

    // The prompt round ran, then supersession stopped the cascade cold: the
    // shrink targets were computed against overwritten geometry.
    expect(rounds).toEqual([{}]);
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:a.md', 'persist:a.md']);
    expect(cascadeFailures).toHaveLength(0);
    expect(h.echoed).toHaveLength(0);
  });

  it('re-checks canWrite after a fence wait: a capability flip during the wait stops the round before any write', async () => {
    const gate = deferred();
    let writable = true;
    const h = harness({
      canWrite: () => writable,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}:${write.patch.progress}`);
        return write.sourcePath === 'kid.md' && write.patch.progress === 7
          ? gate.promise
          : Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);

    // A plain gesture holds kid.md with a slow persist...
    const plain = executor.submit(
      execution('kid.md', () => planOf({ writes: [writeOf('kid.md', 7)] })),
    );
    await flushMicrotasks();
    // ...while a cascade declares a write into kid.md and waits at its fence.
    const cascading = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: { plan: () => cascadePlanOf({ writes: [writeOf('kid.md', 2)] }) },
    });
    await flushMicrotasks();
    writable = false; // e.g. the view flips read-only during the wait
    gate.resolve();
    await Promise.all([plain, cascading]);

    // The post-fence gate stopped the round: no cascade write landed.
    expect(h.log).toEqual(['persist:kid.md:7', 'persist:a.md:1']);
  });

  it('a generation flip in auto mode (no prompts) still writes the descendants, with echoes suppressed', async () => {
    let generation = 0;
    const h = harness({
      generation: () => generation,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        if (write.sourcePath === 'a.md') generation += 1; // remount mid-persist
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return answers.persistedSubtreeWrites === undefined
            ? cascadePlanOf({
                resume: 'after-subtree',
                writes: [writeOf('kid.md', 2)],
                echoes: [revertOf('kid.md')],
              })
            : cascadePlanOf({});
        },
      },
    });

    // The persisted main write's cascade correction is vault data, not view
    // state: it lands even though the view remounted — echoes alone are dropped.
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:a.md', 'persist:kid.md']);
    expect(rounds[2]).toEqual({ persistedSubtreeWrites: [{ sourcePath: 'kid.md' }] });
    expect(h.echoed).toHaveLength(0);
    expect(h.settled).toEqual([{ kind: 'plain' }]);
  });

  it('component death mid-cascade still drops everything: no further writes, echoes, or notices', async () => {
    const cascadeFailures: CascadePhase[] = [];
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        if (write.sourcePath === 'kid.md') h.setLive(false); // the view is destroyed
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return cascadePlanOf({
            resume: 'after-subtree',
            writes: [writeOf('kid.md', 2), writeOf('kid2.md', 3)],
            reverts: [revertOf('kid.md'), revertOf('kid2.md')],
          });
        },
        onFailure: (_error, phase) => cascadeFailures.push(phase),
      },
    });

    // Death after the first cascade persist: the round abandons, no resume.
    expect(rounds).toEqual([{}, {}]);
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:a.md', 'persist:kid.md']);
    expect(h.echoed).toHaveLength(0);
    expect(cascadeFailures).toHaveLength(0);
  });

  it('DESTROYED wins over an alive-looking api closure: teardown mid-persist drops the post-persist cascade entirely', async () => {
    // The host wiring under test: isLive/canWrite close over an api that STAYS
    // assigned through onDestroy — the destroyed flag alone must read as death,
    // and a generation bump alone must keep reading as a survivable remount.
    const host = { api: {} as object | null, destroyed: false, generation: 0 };
    const rounds: CascadeAnswers[] = [];
    const h = harness({
      isLive: () => !host.destroyed && !!host.api,
      canWrite: () => !host.destroyed && !!host.api,
      generation: () => host.generation,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        if (write.sourcePath === 'a.md') {
          host.destroyed = true; // onDestroy: dead first...
          host.generation += 1; // ...then the generation bump
        }
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)], echoes: [revertOf('a.md')] }),
      cascade: {
        plan: (_settlement, answers) => {
          rounds.push(answers);
          return cascadePlanOf({ writes: [writeOf('kid.md', 2)], reverts: [revertOf('kid.md')] });
        },
      },
    });

    expect(host.api).toBeTruthy(); // the closure still sees an assigned api
    expect(rounds).toHaveLength(0); // yet no cascade round ever planned
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:a.md']);
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']); // the pre-persist optimistic echo only
    expect(h.settled).toHaveLength(0); // the settlement report is view work — dropped too
  });

  it('an ask-mode round needing a prompt after a generation flip, with no prompt seam, skips via the failure notice', async () => {
    let generation = 0;
    const cascadeFailures: CascadePhase[] = [];
    const h = harness({
      generation: () => generation,
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        if (write.sourcePath === 'a.md') generation += 1; // remount mid-persist
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps); // the harness wires no prompt seam

    await executor.submit({
      sourcePath: 'a.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: () =>
          cascadePlanOf({
            prompt: {
              kind: 'shrink-fit',
              name: 'Parent',
              attempted: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 2) },
              fit: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 5) },
            },
          }),
        onFailure: (_error, phase) => cascadeFailures.push(phase),
      },
    });

    // The correction could not be asked for: the user learns it was skipped.
    expect(cascadeFailures).toEqual(['shrink']);
    expect(h.log.filter((e) => e.startsWith('persist'))).toEqual(['persist:a.md']);
  });

  it('re-plans a cascade round from the facts a fenced source settled ahead of it: the persisted patch is never the pre-wait plan', async () => {
    const gate = deferred();
    const store = { b: 0 };
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}:${write.patch.progress}`);
        if (write.sourcePath === 'b.md' && write.patch.progress === 7) {
          return gate.promise.then(() => {
            store.b = 7; // the plain gesture's write settles into the facts
          });
        }
        return Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const plannedFrom: number[] = [];

    // A plain gesture holds b.md with a slow persist...
    const plain = executor.submit({
      sourcePath: 'b.md',
      snapshot: () => undefined,
      plan: () => planOf({ writes: [writeOf('b.md', 7)] }),
    });
    await flushMicrotasks();
    // ...while a cascade plans a write into b.md from pre-settlement facts.
    const cascading = executor.submit({
      sourcePath: 'a.md',
      snapshot: () => ({ b: store.b }),
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (_settlement, _answers, facts) => {
          plannedFrom.push(facts.b);
          return cascadePlanOf({ writes: [writeOf('b.md', 100 + facts.b)] });
        },
      },
    });
    await flushMicrotasks();
    gate.resolve();
    await Promise.all([plain, cascading]);

    // Declared from stale facts (0), re-planned post-fence from settled facts
    // (7) — and the persisted patch carries the fresh plan, not the stale one.
    expect(plannedFrom).toEqual([0, 7]);
    expect(h.log).toEqual(['persist:b.md:7', 'persist:a.md:1', 'persist:b.md:107']);
  });
});
