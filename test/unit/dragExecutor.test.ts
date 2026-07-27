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
  plan: (choice: GestureChoice) => GesturePlan | null,
  onFailure?: PlannedExecution['onFailure'],
): PlannedExecution {
  return { sourcePath, snapshot: () => undefined, plan, onFailure };
}

/** Settle enough microtask turns for in-flight executor rounds to reach their persists. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  it('snapshots at dequeue: the queued gesture plans from the FIRST gesture\'s settled write, and ONE capture spans its prompt re-plan and cascade round', async () => {
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
    expect(snapshot).toHaveBeenCalledTimes(1);
    // Plan, prompt re-plan, cascade round — all handed the SAME dequeue capture.
    expect(captures).toHaveLength(3);
    expect(captures[0]).toEqual({ progress: 50 });
    expect(captures[1]).toBe(captures[0]);
    expect(captures[2]).toBe(captures[0]);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual([
      'persist:10',
      'persist:50',
    ]);
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
      snapshot: () => undefined,
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
      snapshot: () => undefined,
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
      snapshot: () => undefined,
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

  it('abandons everything when the host generation changes mid-cascade: no writes, echoes, prompts, or failure reports', async () => {
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

    // The prompt round ran, then the generation gate stopped the cascade cold.
    expect(rounds).toEqual([{}]);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:a.md']);
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
            writes: [writeOf('kid.md', 2)],
          });
        },
      },
    });

    // Round 1 planned and wrote; the per-round gate stopped round 2 outright.
    expect(rounds).toEqual([{}]);
    expect(h.log).toEqual(['persist:a.md', 'persist:kid.md']);
  });
});
