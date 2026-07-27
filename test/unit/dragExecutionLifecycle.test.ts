/**
 * The lifecycle primitive, driven directly through runMain: the write gate,
 * post-await liveness abandonment, revert baselines across rejecting and
 * hung persists, the persist timeout, the prompt seam's re-plan, and the
 * generation-gated echo emitter.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createExecutionLifecycle } from '../../src/bases/dragExecutionLifecycle';
import type { GestureChoice, PlannedWrite } from '../../src/bases/dragCommitPlan';
import type { PromptAnswer } from '../../src/bases/dragExecutor';
import { execution, harness, planOf, revertOf, writeOf } from './dragExecutorTestKit';

describe('createExecutionLifecycle', () => {
  it('abandons cleanly when liveness is lost after an await: no further writes, echoes, or settlement', async () => {
    const h = harness();
    const persist = jest.fn((write: PlannedWrite) => {
      h.log.push(`persist:${write.patch.progress}`);
      h.setLive(false);
      return Promise.resolve();
    });
    const lifecycle = createExecutionLifecycle({ ...h.deps, persist });

    const settlement = await lifecycle.runMain(
      execution('a.md', () =>
        planOf({
          writes: [writeOf('a.md', 1), writeOf('a.md', 2)],
          reverts: [revertOf('a.md')],
        }),
      ),
      0,
    );

    expect(settlement).toBeNull();
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
    const lifecycle = createExecutionLifecycle(h.deps);

    await lifecycle.runMain(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error),
      ),
      0,
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
    const lifecycle = createExecutionLifecycle(h.deps);

    await lifecycle.runMain(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error as Error),
      ),
      0,
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
    const lifecycle = createExecutionLifecycle(h.deps);
    const seenChoices: GestureChoice[] = [];

    await lifecycle.runMain(
      execution('a.md', (choice) => {
        seenChoices.push(choice);
        if (choice === undefined) {
          return planOf({ prompt: { kind: 'inferred-drag' }, echoes: [revertOf('a.md')] });
        }
        return planOf({ writes: [writeOf('a.md', 1)] });
      }),
      0,
    );

    expect(seenChoices).toEqual([undefined, choiceGiven]);
    expect(resolvePrompt).toHaveBeenCalledWith({ kind: 'inferred-drag' });
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']);
    expect(h.log.filter((entry) => entry.startsWith('persist'))).toEqual(['persist:a.md']);
    expect(h.settled).toEqual([{ kind: 'plain' }]);
  });

  it('never runs a plan when the write gate is closed', async () => {
    const plan = jest.fn(() => planOf({ writes: [writeOf('a.md', 1)] }));
    const h = harness({ canWrite: () => false });
    const lifecycle = createExecutionLifecycle(h.deps);

    await lifecycle.runMain(execution('a.md', plan), 0);

    expect(plan).not.toHaveBeenCalled();
    expect(h.settled).toHaveLength(0);
  });

  it('reports each persisted write through the settled-geometry hook, after the persist lands', async () => {
    const recorded: string[] = [];
    const h = harness();
    const lifecycle = createExecutionLifecycle(h.deps, (write) => {
      recorded.push(write.sourcePath);
      expect(h.log).toContain(`persist:${write.sourcePath}`);
    });

    await lifecycle.runMain(
      execution('a.md', () => planOf({ writes: [writeOf('a.md', 1)] })),
      0,
    );

    expect(recorded).toEqual(['a.md']);
  });
});
