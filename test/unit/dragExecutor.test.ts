/**
 * The executor's async choreography, driven through injected fakes: per-source
 * serialization with dequeue-time re-planning, independent sources, per-plan
 * revert baselines, post-await liveness abandonment, the persist timeout, and
 * the prompt seam.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  createDragExecutor,
  type CascadeAnswers,
  type CascadePhase,
  type DragExecutorDeps,
  type PlannedExecution,
  type PromptAnswer,
} from '../../src/bases/dragExecutor';
import type {
  GestureChoice,
  GesturePlan,
  GestureSettlement,
  Plan,
  PlannedWrite,
  SourceEchoes,
} from '../../src/bases/dragCommitPlan';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function planOf(partial: Partial<GesturePlan>): GesturePlan {
  return {
    writes: [],
    echoes: [],
    reverts: [],
    prompt: null,
    resume: null,
    settlement: { onSuccess: { kind: 'plain' }, onFailure: { kind: 'aborted' } },
    ...partial,
  };
}

function writeOf(sourcePath: string, progress: number): PlannedWrite {
  return { sourcePath, instanceId: `${sourcePath}#0`, patch: { progress } };
}

function revertOf(sourcePath: string): SourceEchoes {
  return {
    sourcePath,
    rows: [{ instanceId: `${sourcePath}#0`, payload: { kind: 'progress', progress: 0 } }],
  };
}

interface Harness {
  deps: DragExecutorDeps;
  log: string[];
  echoed: SourceEchoes[];
  settled: GestureSettlement[];
  setLive(live: boolean): void;
}

function harness(overrides: Partial<DragExecutorDeps> = {}): Harness {
  const log: string[] = [];
  const echoed: SourceEchoes[] = [];
  const settled: GestureSettlement[] = [];
  let live = true;
  const deps: DragExecutorDeps = {
    canWrite: () => true,
    isLive: () => live,
    persist: (write) => {
      log.push(`persist:${write.sourcePath}`);
      return Promise.resolve();
    },
    echo: (echoes) => {
      log.push(`echo:${echoes.sourcePath}`);
      echoed.push(echoes);
    },
    onSettled: (settlement) => settled.push(settlement),
    ...overrides,
  };
  return { deps, log, echoed, settled, setLive: (value) => (live = value) };
}

function execution(
  sourcePath: string,
  plan: PlannedExecution['plan'],
  onFailure?: PlannedExecution['onFailure'],
): PlannedExecution {
  return { sourcePath, plan, onFailure };
}

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

  it('abandons cleanly when liveness is lost after an await: no further writes, echoes, or settlement', async () => {
    const h = harness();
    const persist = jest.fn((write: PlannedWrite) => {
      h.log.push(`persist:${write.patch.progress}`);
      h.setLive(false);
      return Promise.resolve();
    });
    const executor = createDragExecutor({ ...h.deps, persist });

    await executor.submit(
      execution('a.md', () =>
        planOf({
          writes: [writeOf('a.md', 1), writeOf('a.md', 2)],
          reverts: [revertOf('a.md')],
        }),
      ),
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(h.echoed).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it('skips reverts and failure reporting when liveness is lost across a rejecting persist', async () => {
    const failures: unknown[] = [];
    const h = harness({
      persist: () => {
        h.setLive(false);
        return Promise.reject(new Error('save failed'));
      },
    });
    const executor = createDragExecutor(h.deps);

    await executor.submit(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error),
      ),
    );

    expect(h.echoed).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it('reverts when a persist never settles within the injected timeout', async () => {
    const failures: Error[] = [];
    const h = harness({
      persist: () => new Promise<void>(() => undefined),
      persistTimeoutMs: 15,
    });
    const executor = createDragExecutor(h.deps);

    await executor.submit(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error as Error),
      ),
    );

    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']);
    expect(failures[0]?.message).toBe('write timed out');
    expect(h.settled).toEqual([{ kind: 'aborted' }]);
  });

  it('emits the optimistic echoes, collects the prompt choice, and executes the re-planned commit', async () => {
    const choiceGiven: GestureChoice = { action: 'estimate-only' };
    const resolvePrompt = jest.fn(() =>
      Promise.resolve<PromptAnswer | null>({ kind: 'inferred-drag', choice: choiceGiven }),
    );
    const h = harness({ resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const seenChoices: GestureChoice[] = [];

    await executor.submit(
      execution('a.md', (choice) => {
        seenChoices.push(choice);
        if (choice === undefined) {
          return planOf({ prompt: { kind: 'inferred-drag' }, echoes: [revertOf('a.md')] });
        }
        return planOf({ writes: [writeOf('a.md', 1)] });
      }),
    );

    expect(seenChoices).toEqual([undefined, choiceGiven]);
    expect(resolvePrompt).toHaveBeenCalledWith({ kind: 'inferred-drag' });
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:a.md']);
    expect(h.settled).toEqual([{ kind: 'plain' }]);
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

  it('never runs a plan when the write gate is closed', async () => {
    const plan = jest.fn(() => planOf({ writes: [writeOf('a.md', 1)] }));
    const h = harness({ canWrite: () => false });
    const executor = createDragExecutor(h.deps);

    await executor.submit(execution('a.md', plan));

    expect(plan).not.toHaveBeenCalled();
    expect(h.settled).toHaveLength(0);
  });
});

function cascadePlanOf(partial: Partial<Plan>): Plan {
  return { writes: [], echoes: [], reverts: [], prompt: null, resume: null, ...partial };
}

describe('createDragExecutor cascade pass', () => {
  it('drives the cascade from the settled gesture in the same queue slot, after the main persist', async () => {
    const h = harness();
    const executor = createDragExecutor(h.deps);
    const seen: GestureSettlement[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (settlement) => {
          seen.push(settlement);
          return cascadePlanOf({ writes: [{ ...writeOf('kid.md', 2), sourcePath: 'kid.md' }] });
        },
      },
    });

    expect(seen).toEqual([{ kind: 'plain' }]);
    expect(h.log).toEqual(['persist:a.md', 'persist:kid.md']);
  });

  it('honors the after-subtree resume: reports ONLY the persisted sources and re-plans', async () => {
    const h = harness({
      persist: (write) => {
        h.log.push(`persist:${write.sourcePath}`);
        return write.sourcePath === 'bad.md' ? Promise.reject(new Error('save failed')) : Promise.resolve();
      },
    });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];
    const failures: CascadePhase[] = [];

    await executor.submit({
      sourcePath: 'a.md',
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
        plan: (_settlement, answers) => {
          rounds.push(answers);
          if (answers.persistedSubtreeSources === undefined) {
            return cascadePlanOf({
              resume: 'after-subtree',
              writes: [
                { ...writeOf('good.md', 2), sourcePath: 'good.md' },
                { ...writeOf('bad.md', 3), sourcePath: 'bad.md' },
              ],
              reverts: [revertOf('good.md'), revertOf('bad.md')],
            });
          }
          return cascadePlanOf({});
        },
        onFailure: (_error, phase) => failures.push(phase),
      },
    });

    expect(rounds).toEqual([{}, { persistedSubtreeSources: ['good.md'] }]);
    // Only the FAILED source's reverts were emitted; the good one stayed put.
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['bad.md']);
    expect(failures).toEqual(['subtree']);
  });

  it('collects a shrink-fit answer through the prompt seam and feeds it to the next round', async () => {
    const resolvePrompt = jest.fn(() =>
      Promise.resolve<PromptAnswer | null>({ kind: 'shrink-fit', choice: 'undo' }),
    );
    const h = harness({ resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const rounds: CascadeAnswers[] = [];

    await executor.submit({
      sourcePath: 'a.md',
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
      },
    });

    expect(rounds).toEqual([{}, { shrinkChoice: 'undo' }]);
    expect(resolvePrompt).toHaveBeenCalledTimes(1);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:a.md', 'persist:a.md']);
  });

  it('reports a failed extend write with the extend phase and no reverts (refresh-only)', async () => {
    const failures: CascadePhase[] = [];
    const h = harness({
      persist: (write) =>
        write.unmirrored ? Promise.reject(new Error('save failed')) : Promise.resolve(),
    });
    const executor = createDragExecutor(h.deps);

    await executor.submit({
      sourcePath: 'a.md',
      plan: () => planOf({ writes: [writeOf('a.md', 1)] }),
      cascade: {
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
      },
    });

    expect(failures).toEqual(['extend']);
    expect(h.echoed).toHaveLength(0);
  });

  it('runs no cascade when the gesture prompt is cancelled into an aborted, write-less plan', async () => {
    const resolvePrompt = jest.fn(() =>
      Promise.resolve<PromptAnswer | null>({ kind: 'inferred-drag', choice: null }),
    );
    const h = harness({ resolvePrompt });
    const executor = createDragExecutor(h.deps);
    const cascadeSettlements: GestureSettlement[] = [];

    await executor.submit({
      sourcePath: 'a.md',
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
});
