/**
 * The lifecycle primitive, driven directly through runMain: the write gate,
 * post-await liveness abandonment, revert baselines across rejecting persists,
 * the slow-persist deadline (report-and-keep-waiting), the prompt seam's
 * re-plan, and the generation-gated echo emitter.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createExecutionLifecycle } from '../../src/bases/dragExecutionLifecycle';
import type { GestureChoice, PlannedWrite } from '../../src/bases/dragCommitPlan';
import type { PromptAnswer } from '../../src/bases/dragExecutor';
import { deferred, execution, harness, planOf, revertOf, writeOf } from './dragExecutorTestKit';

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

  it('a persist past the deadline reports but stays awaited: a late success settles normally, without reverts', async () => {
    const slow = deferred();
    const timedOut: string[] = [];
    const recorded: string[] = [];
    const h = harness({
      persist: () => slow.promise,
      persistTimeoutMs: 5,
      onPersistTimeout: (write) => timedOut.push(write.sourcePath),
    });
    const lifecycle = createExecutionLifecycle(h.deps, (write) => recorded.push(write.sourcePath));

    let settled = false;
    const run = lifecycle
      .runMain(
        execution('a.md', () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] })),
        0,
      )
      .then((settlement) => {
        settled = true;
        return settlement;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The deadline fired its report, but the execution is still waiting — the
    // source queue slot is held, so no newer gesture can persist underneath.
    expect(timedOut).toEqual(['a.md']);
    expect(settled).toBe(false);
    expect(recorded).toEqual([]);

    slow.resolve();
    expect(await run).toEqual({ kind: 'plain' });
    expect(h.echoed).toHaveLength(0); // no reverts: the vault write landed
    expect(recorded).toEqual(['a.md']); // the settled-write hooks still tick
    expect(h.settled).toEqual([{ kind: 'plain' }]);
  });

  it('a persist past the deadline that then rejects reverts with the REAL error', async () => {
    const slow = deferred();
    const failures: Error[] = [];
    const timedOut: string[] = [];
    const h = harness({
      persist: () => slow.promise,
      persistTimeoutMs: 5,
      onPersistTimeout: (write) => timedOut.push(write.sourcePath),
    });
    const lifecycle = createExecutionLifecycle(h.deps);

    const run = lifecycle.runMain(
      execution(
        'a.md',
        () => planOf({ writes: [writeOf('a.md', 1)], reverts: [revertOf('a.md')] }),
        (error) => failures.push(error as Error),
      ),
      0,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    slow.reject(new Error('save failed'));

    expect(await run).toEqual({ kind: 'aborted' });
    expect(timedOut).toEqual(['a.md']);
    expect(h.echoed.map((e) => e.sourcePath)).toEqual(['a.md']);
    expect(failures[0]?.message).toBe('save failed');
    expect(h.settled).toEqual([{ kind: 'aborted' }]);
  });

  it('signals per-write settlement with the same sourcePath the timeout named, once the slow MAIN write settles', async () => {
    const slow = deferred();
    const timedOut: string[] = [];
    const writeSettled: string[] = [];
    const h = harness({
      persist: () => slow.promise,
      persistTimeoutMs: 5,
      onPersistTimeout: (write) => timedOut.push(write.sourcePath),
      onWriteSettled: (write) => writeSettled.push(write.sourcePath),
    });
    const lifecycle = createExecutionLifecycle(h.deps);

    const run = lifecycle.runMain(
      execution('a.md', () => planOf({ writes: [writeOf('a.md', 1)] })),
      0,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The timeout named the write's source; settlement has not signalled yet.
    expect(timedOut).toEqual(['a.md']);
    expect(writeSettled).toEqual([]);

    slow.resolve();
    await run;
    expect(writeSettled).toEqual(['a.md']); // the SAME source, on ITS settlement
  });

  it('signals per-write settlement on the CASCADE write path too, for success AND failure alike', async () => {
    const writeSettled: string[] = [];
    const h = harness({
      persist: (write) =>
        write.sourcePath === 'bad.md' ? Promise.reject(new Error('save failed')) : Promise.resolve(),
      onWriteSettled: (write) => writeSettled.push(write.sourcePath),
    });
    const lifecycle = createExecutionLifecycle(h.deps);

    // Cascade rounds persist through persistWrite directly (no executePlan).
    await lifecycle.persistWrite(writeOf('kid.md', 1));
    await expect(lifecycle.persistWrite(writeOf('bad.md', 1))).rejects.toThrow('save failed');

    expect(writeSettled).toEqual(['kid.md', 'bad.md']);
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
