/**
 * Shared fakes for the drag-executor family of suites (the composed executor
 * and its three primitives): plan/write/echo builders and the injected-deps
 * harness that records persists, echoes, and settlements.
 */
import type {
  DragExecutorDeps,
  PlannedExecution,
} from '../../src/bases/dragExecutor';
import type {
  GestureChoice,
  GesturePlan,
  GestureSettlement,
  Plan,
  PlannedWrite,
  SourceEchoes,
} from '../../src/bases/dragCommitPlan';

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function planOf(partial: Partial<GesturePlan>): GesturePlan {
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

export function cascadePlanOf(partial: Partial<Plan>): Plan {
  return { writes: [], echoes: [], reverts: [], prompt: null, resume: null, ...partial };
}

export function writeOf(sourcePath: string, progress: number): PlannedWrite {
  return { sourcePath, instanceId: `${sourcePath}#0`, patch: { progress } };
}

export function revertOf(sourcePath: string): SourceEchoes {
  return {
    sourcePath,
    rows: [{ instanceId: `${sourcePath}#0`, payload: { kind: 'progress', progress: 0 } }],
  };
}

export interface Harness {
  deps: DragExecutorDeps;
  log: string[];
  echoed: SourceEchoes[];
  settled: GestureSettlement[];
  setLive(live: boolean): void;
}

export function harness(overrides: Partial<DragExecutorDeps> = {}): Harness {
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

export function execution(
  sourcePath: string,
  plan: (choice: GestureChoice) => GesturePlan | null,
  onFailure?: PlannedExecution['onFailure'],
): PlannedExecution {
  return { sourcePath, snapshot: () => undefined, plan, onFailure };
}

/** Settle enough microtask turns for in-flight executor rounds to reach their persists. */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
