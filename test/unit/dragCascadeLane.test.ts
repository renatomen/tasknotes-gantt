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
import type { GestureSettlement } from '../../src/bases/dragCommitPlan';
import type { PromptAnswer } from '../../src/bases/dragExecutor';
import { cascadePlanOf, harness, revertOf, writeOf, type Harness } from './dragExecutorTestKit';

function laneOf(h: Harness) {
  const queues = createSourceQueues();
  const clock = createGeometryClock();
  const lifecycle = createExecutionLifecycle(h.deps, clock.recordSettledGeometry);
  return createCascadeLane({ deps: h.deps, lifecycle, queues, clock });
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
    const lane = laneOf(h);
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
    const lane = laneOf(h);
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
    const lane = laneOf(h);
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
    const lane = laneOf(h);

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
    const lane = laneOf(h);
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
