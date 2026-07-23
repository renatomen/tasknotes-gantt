/**
 * U6: GanttController Unit Tests
 *
 * Verifies the read-only (Milestone 1) action layer against fake sources
 * injected through `deps` — no real Obsidian app or TaskNotes plugin:
 * - Source selection: TaskNotes available → TaskNotesSource; absent → BasesSource.
 * - Reactive re-selection: TaskNotes appearing/disappearing after init flips the
 *   active source and capabilities, via onExternalSourceChange().
 * - getInstances(): multi-parent SourceTasks expand to RenderInstances consistent
 *   with InstanceExpansion.
 * - getLinks(): a blockedBy dependency yields a rewritten RenderLink with the
 *   correct SVAR type; a Bases source (no deps) yields no links.
 * - capabilities reflect the active source (write=false in M1).
 * - onChange: a source change event notifies listeners; an event recomputing to a
 *   value-equal snapshot does NOT notify (the idempotent backstop).
 *
 * Following testing-standards.md: Jest, mocked deps via DI, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { App } from 'obsidian';
import {
  GanttController,
  computeRecomputeReason,
  buildSourceLinks,
} from '../../src/controller/GanttController';
import type {
  GanttControllerDeps,
  DatePolicyConfig,
} from '../../src/controller/GanttController';
import type {
  DataSource,
  DataSourceCapabilities,
  SourceDependency,
  SourceTask,
} from '../../src/datasource/types';
import type { BasesEntry } from 'obsidian';

/** Concise SourceTask factory. */
function task(partial: Partial<SourceTask> & { path: string }): SourceTask {
  return {
    text: partial.path,
    start: null,
    end: null,
    progress: null,
    status: null,
    parents: [],
    ...partial,
  };
}

/**
 * A controllable fake source. Holds a mutable task/dependency set and (when
 * subscribable) captures the registered change handler so a test can fire it.
 */
class FakeSource implements DataSource {
  public readonly capabilities: DataSourceCapabilities;
  public tasks: SourceTask[];
  public deps: Record<string, SourceDependency[]>;
  /** The handler registered via subscribe(), if subscription is enabled. */
  public changeHandler: (() => void) | null = null;
  public unsubscribed = false;
  /** Count of getTasks() calls (#161 storm fix: a config-only refresh must NOT re-read). */
  public getTasksCalls = 0;

  private readonly subscribable: boolean;

  private readonly fieldConfig: import('../../src/datasource/types').FieldConfig | null;

  constructor(opts: {
    write?: boolean;
    tasks?: SourceTask[];
    deps?: Record<string, SourceDependency[]>;
    subscribable?: boolean;
    fieldConfig?: import('../../src/datasource/types').FieldConfig | null;
  }) {
    this.capabilities = { write: opts.write ?? false };
    this.tasks = opts.tasks ?? [];
    this.deps = opts.deps ?? {};
    this.subscribable = opts.subscribable ?? false;
    // A writable enrichment must expose a resolvable field config, else the
    // bases-scoped composite is forced read-only (R-F). Default a minimal one
    // for write:true fakes so they reflect a realistic writable TaskNotes.
    this.fieldConfig =
      opts.fieldConfig ??
      (opts.write
        ? { scheduledProp: 'scheduled', dueProp: 'due', dateFields: [] }
        : null);
  }

  async getTasks(): Promise<SourceTask[]> {
    this.getTasksCalls += 1;
    return this.tasks;
  }

  async getDependencies(path: string): Promise<SourceDependency[]> {
    return this.deps[path] ?? [];
  }

  async getFieldConfig(): Promise<import('../../src/datasource/types').FieldConfig | null> {
    return this.fieldConfig;
  }

  // Present only when subscribable so it mirrors TaskNotesSource (Bases has no
  // subscribe method). The controller feature-detects this.
  subscribe?(handler: () => void): () => void;

  /** Enable subscription support (mirrors TaskNotesSource.subscribe). */
  enableSubscribe(): void {
    this.subscribe = (handler: () => void) => {
      this.changeHandler = handler;
      return () => {
        this.unsubscribed = true;
        this.changeHandler = null;
      };
    };
  }

  /** Fire the registered change handler, simulating a source event. */
  fireChange(): void {
    this.changeHandler?.();
  }
}

/**
 * A companion-capable enrichment fake: a FakeSource that also exposes the bulk
 * relationship index (`getRelationshipIndex`), so the controller's companion
 * stage activates (toCompanionAccessor duck-types on it). The index is built
 * from the same `subtasks`/`parents` maps the test fixtures use, and a counter
 * records how many times it was requested (plan #161 — must be once per build).
 */
class CompanionEnrichment extends FakeSource {
  private readonly index: import('../../src/datasource/companionResolve').RelationshipIndex;
  public relationshipIndexCalls = 0;
  constructor(opts: {
    subtasks?: Record<string, SourceTask[]>;
    parents?: Record<string, string[]>;
    deps?: Record<string, SourceDependency[]>;
  }) {
    super({ deps: opts.deps });
    const childrenByPath = new Map<string, SourceTask[]>(
      Object.entries(opts.subtasks ?? {}),
    );
    const parentsByPath = new Map<string, string[]>(
      Object.entries(opts.parents ?? {}),
    );
    this.index = { childrenByPath, parentsByPath };
  }
  async getRelationshipIndex(): Promise<
    import('../../src/datasource/companionResolve').RelationshipIndex
  > {
    this.relationshipIndexCalls += 1;
    return this.index;
  }
}

/** A no-op App stand-in (the fake deps never touch it). */
const fakeApp = {} as App;

/** Bases input provider stub (only consulted when TaskNotes is absent). */
function basesInputStub() {
  return { entries: [], mappings: {} as never };
}

/** Build a controller wired to explicit fake sources. */
function makeController(
  deps: GanttControllerDeps,
  basesInput = basesInputStub,
): GanttController {
  return new GanttController({ app: fakeApp, basesInput, deps });
}

describe('GanttController — source selection', () => {
  it('selects the TaskNotes source when it resolves', async () => {
    const tn = new FakeSource({ write: false, tasks: [task({ path: 'a.md' })] });
    const bases = new FakeSource({ tasks: [] });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => bases,
    });

    await controller.init();

    const instances = await controller.getInstances();
    expect(instances.map((i) => i.sourcePath)).toEqual(['a.md']);
  });

  it('falls back to the Bases source when TaskNotes is absent (create → null)', async () => {
    const bases = new FakeSource({ tasks: [task({ path: 'b.md' })] });
    const createBases = jest.fn(() => bases as DataSource);
    const controller = makeController({
      createTaskNotesSource: async () => null,
      createBasesSource: createBases,
    });

    await controller.init();

    expect(createBases).toHaveBeenCalledTimes(1);
    const instances = await controller.getInstances();
    expect(instances.map((i) => i.sourcePath)).toEqual(['b.md']);
  });
});

describe('GanttController — managed paths', () => {
  it('caches getManagedPaths across calls until the enrichment changes', async () => {
    const tn = new FakeSource({ write: false, tasks: [task({ path: 'a.md' })] });
    const managedSpy = jest.fn(async () => new Set(['a.md']));
    (tn as unknown as { getManagedPaths: () => Promise<ReadonlySet<string>> }).getManagedPaths =
      managedSpy;
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({ tasks: [] }),
    });
    await controller.init();

    // Act — two reads without any TaskNotes data change in between.
    const first = await controller.getManagedPaths();
    const second = await controller.getManagedPaths();

    // Assert — one source hit; echo/config refreshes must not re-list tasks.
    expect(first).toEqual(new Set(['a.md']));
    expect(second).toBe(first);
    expect(managedSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GanttController — choice options', () => {
  it('caches getChoiceOptions per role across calls until the enrichment changes', async () => {
    const tn = new FakeSource({ write: false, tasks: [task({ path: 'a.md' })] });
    const optionsSpy = jest.fn(async (role: string) =>
      role === 'status' ? [{ value: 'open', label: 'Open' }] : [{ value: 'high', label: 'High' }],
    );
    (tn as unknown as { getChoiceOptions: typeof optionsSpy }).getChoiceOptions = optionsSpy;
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({ tasks: [] }),
    });
    await controller.init();

    // Act — repeated reads per role without a TaskNotes data change in between.
    const status1 = await controller.getChoiceOptions('status');
    const status2 = await controller.getChoiceOptions('status');
    const priority1 = await controller.getChoiceOptions('priority');
    const priority2 = await controller.getChoiceOptions('priority');

    // Assert — one source hit per role; echo/config refreshes reuse the cache.
    expect(status1).toEqual([{ value: 'open', label: 'Open' }]);
    expect(status2).toBe(status1);
    expect(priority1).toEqual([{ value: 'high', label: 'High' }]);
    expect(priority2).toBe(priority1);
    expect(optionsSpy).toHaveBeenCalledTimes(2);
  });
});

describe('GanttController — reactive re-selection', () => {
  it('upgrades Bases → TaskNotes when TaskNotes becomes available after init', async () => {
    const tn = new FakeSource({ write: true, tasks: [task({ path: 'tn.md' })] });
    const bases = new FakeSource({ write: false, tasks: [task({ path: 'bs.md' })] });

    // TaskNotes absent on init, present on the second selection.
    let taskNotesReady = false;
    const controller = makeController({
      createTaskNotesSource: async () => (taskNotesReady ? tn : null),
      createBasesSource: () => bases,
    });

    await controller.init();
    expect(controller.capabilities.write).toBe(false);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['bs.md']);

    // TaskNotes comes online; the view/test triggers re-selection.
    taskNotesReady = true;
    await controller.onExternalSourceChange();

    expect(controller.capabilities.write).toBe(true);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['tn.md']);
  });

  it('falls back to Bases when TaskNotes goes away mid-session', async () => {
    const tn = new FakeSource({ write: true, tasks: [task({ path: 'tn.md' })] });
    const bases = new FakeSource({ write: false, tasks: [task({ path: 'bs.md' })] });

    let taskNotesReady = true;
    const controller = makeController({
      createTaskNotesSource: async () => (taskNotesReady ? tn : null),
      createBasesSource: () => bases,
    });

    await controller.init();
    expect(controller.capabilities.write).toBe(true);

    taskNotesReady = false;
    await controller.onExternalSourceChange();

    expect(controller.capabilities.write).toBe(false);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['bs.md']);
  });
});

describe('GanttController — recompute race guard (recomputeSeq)', () => {
  it('latest-wins: a stale recompute resolving LAST does not clobber the newer one', async () => {
    const tn = new FakeSource({ write: true, tasks: [task({ path: 'init.md' })] });
    tn.enableSubscribe();
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });
    await controller.init();
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['init.md']);

    // Gate getTasks so we control the resolution order of two overlapping
    // recomputes. fireChange() triggers recompute synchronously up to the
    // getTasks await, so each call queues exactly one resolver.
    const gates: Array<(t: SourceTask[]) => void> = [];
    tn.getTasks = () => new Promise<SourceTask[]>((resolve) => gates.push(resolve));

    tn.fireChange(); // recompute seq N (older)
    tn.fireChange(); // recompute seq N+1 (newer = latest)
    expect(gates).toHaveLength(2);

    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    // Resolve the NEWER recompute first → snapshot becomes 'new.md'.
    gates[1]!([task({ path: 'new.md' })]);
    await flush();
    // Then resolve the OLDER (now-stale) recompute → the seq guard must DISCARD
    // it, even though it resolved last, so the snapshot stays 'new.md'.
    gates[0]!([task({ path: 'old.md' })]);
    await flush();

    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['new.md']);
  });
});

describe('GanttController — getInstances expansion', () => {
  it('expands multi-parent source tasks consistently with InstanceExpansion', async () => {
    // child has parents [A, B], both visible → two instances (under A, under B).
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'B.md' }),
      task({ path: 'child.md', parents: ['A.md', 'B.md'] }),
    ];
    const tn = new FakeSource({ tasks });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const instances = await controller.getInstances();

    // A, B (roots) + two duplicated child instances = 4.
    expect(instances).toHaveLength(4);
    const childInstances = instances.filter((i) => i.sourcePath === 'child.md');
    expect(childInstances).toHaveLength(2);
    expect(childInstances.every((i) => i.isVirtual)).toBe(true);
    // One under A's row, one under B's row.
    expect(childInstances.map((i) => i.parent).sort()).toEqual(['A.md', 'B.md']);
  });

  it('yields no instances for an empty source (no dummy data)', async () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({ tasks: [] }),
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    expect(await controller.getInstances()).toEqual([]);
  });
});

describe('GanttController — gated debug build log (#161)', () => {
  const flagged = globalThis as { __tnGanttDebug?: boolean };
  afterEach(() => {
    delete flagged.__tnGanttDebug;
    jest.restoreAllMocks();
  });

  /** A bases-scoped controller whose snapshot build runs the diagnostic stage-log. */
  function buildLogController(): GanttController {
    const base = new FakeSource({ tasks: [task({ path: 'U.md' })] });
    return new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => null,
      },
    });
  }

  const sawBuildLog = (spy: jest.SpyInstance): boolean =>
    spy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('[OGDBG] build')),
    );

  it('stays silent (no build diagnostic) when debug is off — the default', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await buildLogController().init();
    expect(sawBuildLog(spy)).toBe(false);
  });

  it('emits the build stage-timing diagnostic when window.__tnGanttDebug is enabled', async () => {
    flagged.__tnGanttDebug = true;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await buildLogController().init();
    expect(sawBuildLog(spy)).toBe(true);
  });
});

describe('GanttController — getLinks', () => {
  it('rewrites a blockedBy dependency into a RenderLink with the correct SVAR type', async () => {
    // pred.md blocks dep.md via FINISHTOSTART → SVAR 'e2s'.
    const tasks = [task({ path: 'pred.md' }), task({ path: 'dep.md' })];
    const tn = new FakeSource({
      tasks,
      deps: {
        'dep.md': [{ predecessorPath: 'pred.md', reltype: 'FINISHTOSTART', gap: null }],
      },
    });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const links = await controller.getLinks('primary');

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source: 'pred.md',
      target: 'dep.md',
      type: 'e2s',
    });
  });

  it('maps every reltype to its SVAR link type', async () => {
    const tasks = [task({ path: 'p.md' }), task({ path: 'q.md' })];
    const cases: Array<[SourceDependency['reltype'], string]> = [
      ['FINISHTOSTART', 'e2s'],
      ['STARTTOSTART', 's2s'],
      ['FINISHTOFINISH', 'e2e'],
      ['STARTTOFINISH', 's2e'],
    ];

    for (const [reltype, expected] of cases) {
      const tn = new FakeSource({
        tasks,
        deps: { 'q.md': [{ predecessorPath: 'p.md', reltype, gap: null }] },
      });
      const controller = makeController({
        createTaskNotesSource: async () => tn,
        createBasesSource: () => new FakeSource({}),
      });
      await controller.init();
      const links = await controller.getLinks('primary');
      expect(links[0]?.type).toBe(expected);
    }
  });

  it('carries reltype + gap from the dependency edge to the RenderLink', async () => {
    const tasks = [task({ path: 'pred.md' }), task({ path: 'dep.md' })];
    const tn = new FakeSource({
      tasks,
      deps: { 'dep.md': [{ predecessorPath: 'pred.md', reltype: 'STARTTOSTART', gap: 'P1D' }] },
    });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });
    await controller.init();
    const [link] = await controller.getLinks('primary');
    expect(link).toMatchObject({ type: 's2s', reltype: 'STARTTOSTART', gap: 'P1D' });
  });

  it('produces no links for a Bases source (no dependency model)', async () => {
    const bases = new FakeSource({ tasks: [task({ path: 'b.md' })] });
    const controller = makeController({
      createTaskNotesSource: async () => null,
      createBasesSource: () => bases,
    });

    await controller.init();
    expect(await controller.getLinks('primary')).toEqual([]);
  });
});

describe('GanttController — capabilities', () => {
  it('reflects the active source (write=false in M1)', async () => {
    const tn = new FakeSource({ write: false, tasks: [] });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    expect(controller.capabilities).toEqual({ write: false });
  });

  it('reports read-only before init', () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({ write: true }),
      createBasesSource: () => new FakeSource({}),
    });
    expect(controller.capabilities.write).toBe(false);
  });
});

describe('GanttController — onChange refresh + idempotent backstop', () => {
  it('notifies listeners when a source change event alters the snapshot', async () => {
    const tn = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    tn.enableSubscribe();
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    // Mutate the source's data, then fire a change event.
    tn.tasks = [task({ path: 'a.md' }), task({ path: 'b.md' })];
    tn.fireChange();
    // Allow the async recompute to settle.
    await flushAsync();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['a.md', 'b.md']);
  });

  it('does NOT notify when a change event recomputes a value-equal snapshot (backstop)', async () => {
    const tn = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    tn.enableSubscribe();
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    // Fire a change event WITHOUT altering the data → recompute is value-equal.
    tn.fireChange();
    await flushAsync();

    expect(listener).not.toHaveBeenCalled();
  });

  it('does NOT notify on repeated refreshSource when data + capability are unchanged (#161 in-place loop fix)', async () => {
    const tn = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    // Simulate Bases re-notifying repeatedly with identical data (the loop):
    // each refreshSource recomputes a value-equal snapshot, so the idempotent
    // backstop must suppress every notify — no re-render, no feedback loop.
    await controller.refreshSource();
    await controller.refreshSource();
    await controller.refreshSource();

    expect(listener).not.toHaveBeenCalled();
  });

  it('still notifies on refreshSource when the data actually changed', async () => {
    const tn = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    tn.tasks = [task({ path: 'a.md' }), task({ path: 'b.md' })];
    await controller.refreshSource();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['a.md', 'b.md']);
  });

  it('notifies on a write-capability flip via re-selection even when the snapshot is unchanged', async () => {
    const ro = new FakeSource({ tasks: [task({ path: 'a.md' })], write: false });
    const rw = new FakeSource({ tasks: [task({ path: 'a.md' })], write: true });
    let current: FakeSource = ro;
    const controller = makeController({
      createTaskNotesSource: async () => current,
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    // Same data, but the active source's write capability flips — recompute
    // must still notify so write affordances update (the case the old
    // force-notify covered, now driven by capability-change detection).
    current = rw;
    await controller.onExternalSourceChange();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the previous source on re-selection', async () => {
    const tn = new FakeSource({ tasks: [] });
    tn.enableSubscribe();
    let ready = true;
    const controller = makeController({
      createTaskNotesSource: async () => (ready ? tn : null),
      createBasesSource: () => new FakeSource({}),
    });

    await controller.init();
    expect(tn.changeHandler).not.toBeNull();

    ready = false;
    await controller.onExternalSourceChange();

    expect(tn.unsubscribed).toBe(true);
  });
});

describe('GanttController — date policy + stable instance set (#161 R1)', () => {
  // A fixed "today" so placeholder placement and assertions are deterministic.
  const FIXED_TODAY = new Date(2026, 5, 17); // 2026-06-17
  const AUG17 = new Date(2026, 7, 17, 12, 0, 0); // noon → exercises normalization

  /** Build a controller with explicit policy config + injected clock. */
  function makeControllerWith(
    policyConfig: DatePolicyConfig,
    tasks: SourceTask[],
  ): GanttController {
    const tn = new FakeSource({ tasks });
    return new GanttController({
      app: fakeApp,
      basesInput: basesInputStub,
      policyConfig,
      now: () => FIXED_TODAY,
      deps: {
        createTaskNotesSource: async () => tn,
        createBasesSource: () => new FakeSource({}),
      },
    });
  }

  // The derivation is now visibility-free (KTD7): its only data-shaping input is
  // `defaultDuration`. The show-undated/show-partial toggles are pure VIEW filters
  // (#161) and cannot be expressed at the controller seam — so the instance set is
  // stable by construction, which is exactly what R1 demands.
  const dur1: DatePolicyConfig = { defaultDuration: 1 };

  it('stretches a duration-derived end past blocked days and threads ghostRuns (AE2)', async () => {
    let passes = 0;
    const stretchConfig: DatePolicyConfig = {
      defaultDuration: 1,
      estimateMeaningForTask: () => 'working-days',
      nonWorkingRendering: 'split',
      workingTimeStretch: {
        blockingForTasks: () => {
          passes += 1;
          return () => ({
            isBlocked: (iso) => iso === '2026-08-08' || iso === '2026-08-09',
            maxBlockedRunDays: 2,
          });
        },
      },
    };
    const controller = makeControllerWith(stretchConfig, [
      // Friday 2026-08-07, 3-working-day estimate; Sat/Sun blocked → ends Tuesday.
      task({ path: 'friday.md', start: new Date(2026, 7, 7), estimate: 3 * 1440 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('inferred-end');
    expect(inst?.end?.getDate()).toBe(11);
    expect(inst?.ghostRuns).toEqual([{ startDate: '2026-08-08', days: 2 }]);
    expect(inst?.stretchFlagged).toBeUndefined();
    expect(passes).toBe(1);
  });

  it('never moves an authored complete span even with blocking present (R12)', async () => {
    const stretchConfig: DatePolicyConfig = {
      defaultDuration: 1,
      // Working-days interpretation is ON, so this proves a `complete` status
      // resists re-projection even when the stretch path is fully engaged.
      estimateMeaningForTask: () => 'working-days',
      workingTimeStretch: {
        blockingForTasks: () => () => ({ isBlocked: () => true, maxBlockedRunDays: 5 }),
      },
    };
    const controller = makeControllerWith(stretchConfig, [
      task({ path: 'complete.md', start: new Date(2026, 7, 7), end: AUG17 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('complete');
    expect(inst?.start?.getDate()).toBe(7);
    expect(inst?.end?.getDate()).toBe(17);
    expect(inst?.ghostRuns).toBeUndefined();
  });

  it('falls back to the calendar-day span and flags when the scan hits its ceiling', async () => {
    const stretchConfig: DatePolicyConfig = {
      defaultDuration: 1,
      estimateMeaningForTask: () => 'working-days',
      // Split rendering is ON, so this also proves a ceiling-flagged fallback
      // suppresses ghost runs (a fully-blocked span degrades to one plain bar).
      nonWorkingRendering: 'split',
      workingTimeStretch: {
        blockingForTasks: () => () => ({ isBlocked: () => true, maxBlockedRunDays: 3 }),
      },
    };
    const controller = makeControllerWith(stretchConfig, [
      task({ path: 'blocked.md', start: new Date(2026, 7, 7), estimate: 2 * 1440 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.stretchFlagged).toBe(true);
    // The calendar-day placement (start + duration - 1) is untouched.
    expect(inst?.end?.getDate()).toBe(8);
    expect(inst?.ghostRuns).toBeUndefined();
  });

  it('splits a concrete authored span without re-projecting it (rendering axis alone, R-axes)', async () => {
    const splitOnlyConfig: DatePolicyConfig = {
      defaultDuration: 1,
      // Calendar-days interpretation: NO re-projection. Split rendering still
      // reveals the blocked days inside the authored span — the two axes are
      // independent (this combination was unreachable under the old fused knob).
      estimateMeaningForTask: () => 'calendar-days',
      nonWorkingRendering: 'split',
      workingTimeStretch: {
        blockingForTasks: () => () => ({
          isBlocked: (iso) => iso === '2026-08-08' || iso === '2026-08-09',
          maxBlockedRunDays: 2,
        }),
      },
    };
    const controller = makeControllerWith(splitOnlyConfig, [
      task({ path: 'concrete.md', start: new Date(2026, 7, 7), end: new Date(2026, 7, 11) }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('complete');
    // Authored end is untouched (no re-projection under calendar-days).
    expect(inst?.end?.getDate()).toBe(11);
    // Yet the inner blocked days surface as a ghost run.
    expect(inst?.ghostRuns).toEqual([{ startDate: '2026-08-08', days: 2 }]);
    expect(inst?.stretchFlagged).toBeUndefined();
  });

  it('re-projects under working-days without splitting when rendering is shaded (meaning axis alone)', async () => {
    const meaningOnlyConfig: DatePolicyConfig = {
      defaultDuration: 1,
      estimateMeaningForTask: () => 'working-days',
      nonWorkingRendering: 'shaded',
      workingTimeStretch: {
        blockingForTasks: () => () => ({
          isBlocked: (iso) => iso === '2026-08-08' || iso === '2026-08-09',
          maxBlockedRunDays: 2,
        }),
      },
    };
    const controller = makeControllerWith(meaningOnlyConfig, [
      task({ path: 'friday.md', start: new Date(2026, 7, 7), estimate: 3 * 1440 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    // The derived end still re-projects past the blocked days...
    expect(inst?.dateStatus).toBe('inferred-end');
    expect(inst?.end?.getDate()).toBe(11);
    // ...but shaded rendering attaches no ghost runs (background shading only).
    expect(inst?.ghostRuns).toBeUndefined();
  });

  it('resolves a due-only task to its deadline, not today→due', async () => {
    const controller = makeControllerWith(dur1, [task({ path: 'due.md', end: AUG17 })]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('inferred-start');
    // D=1 → single-day bar at the due date (August), NOT spanning from today (June).
    expect(inst?.start?.getMonth()).toBe(7);
    expect(inst?.start?.getDate()).toBe(17);
    expect(inst?.end?.getMonth()).toBe(7);
  });

  it('propagates dateStatus onto every RenderInstance', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
      task({ path: 'dateless.md' }),
    ]);
    await controller.init();
    const byPath = new Map((await controller.getInstances()).map((i) => [i.sourcePath, i]));

    expect(byPath.get('complete.md')?.dateStatus).toBe('complete');
    expect(byPath.get('dateless.md')?.dateStatus).toBe('placeholder');
  });

  it('retains undated tasks tagged placeholder — derivation never drops them (R1)', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'dateless.md' }),
      task({ path: 'due.md', end: AUG17 }),
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
    ]);
    await controller.init();
    const byPath = new Map((await controller.getInstances()).map((i) => [i.sourcePath, i]));

    // ALL three present (visibility is a view filter, not a derivation drop).
    expect([...byPath.keys()].sort()).toEqual(['complete.md', 'dateless.md', 'due.md']);
    // The undated row carries the `placeholder` tag the view filter keys off of.
    expect(byPath.get('dateless.md')?.dateStatus).toBe('placeholder');
  });

  it('retains partial-date tasks tagged inferred-* — derivation never drops them (R1)', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'dateless.md' }),
      task({ path: 'due.md', end: AUG17 }),
      task({ path: 'start.md', start: new Date(2026, 7, 1) }),
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
    ]);
    await controller.init();
    const byPath = new Map((await controller.getInstances()).map((i) => [i.sourcePath, i]));

    expect([...byPath.keys()].sort()).toEqual([
      'complete.md',
      'dateless.md',
      'due.md',
      'start.md',
    ]);
    // Both one-date rows carry a PARTIAL tag the view's show-partial filter keys off.
    expect(byPath.get('due.md')?.dateStatus).toBe('inferred-start');
    expect(byPath.get('start.md')?.dateStatus).toBe('inferred-end');
  });

  // U5: a task's Time Estimate (minutes) overrides the per-view default duration
  // when inferring a missing date; a fully-dated task ignores it (dates win).
  it('infers the end from a start + estimate (2880 min → 2-day bar), overriding default duration', async () => {
    // dur1 = single-day default; the 2-day estimate must win over it.
    const controller = makeControllerWith(dur1, [
      task({ path: 'start.md', start: new Date(2026, 7, 1), estimate: 2880 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('inferred-end');
    // duration=2 → inclusive span [Aug 1, Aug 2].
    expect(inst?.start?.getDate()).toBe(1);
    expect(inst?.end?.getDate()).toBe(2);
    expect(inst?.end?.getMonth()).toBe(7);
  });

  it('infers the start from a due + estimate (2880 min), running back from the deadline', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'due.md', end: new Date(2026, 7, 10), estimate: 2880 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('inferred-start');
    // duration=2 → [Aug 9, Aug 10].
    expect(inst?.start?.getDate()).toBe(9);
    expect(inst?.end?.getDate()).toBe(10);
  });

  it('places a dateless task with a sub-day estimate as a one-day placeholder at today', async () => {
    const controller = makeControllerWith(dur1, [task({ path: 'est.md', estimate: 120 })]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('placeholder');
    // ceil(120/1440)=1 → single-day bar at FIXED_TODAY (2026-06-17).
    expect(inst?.start?.getMonth()).toBe(5);
    expect(inst?.start?.getDate()).toBe(17);
    expect(inst?.end?.getDate()).toBe(17);
  });

  it('ignores the estimate for a fully-dated task (dates win)', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'both.md', start: new Date(2026, 7, 1), end: new Date(2026, 7, 20), estimate: 120 }),
    ]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('complete');
    expect(inst?.start?.getDate()).toBe(1);
    expect(inst?.end?.getDate()).toBe(20);
  });

  it('falls back to the default duration when a task has no usable estimate', async () => {
    const dur3: DatePolicyConfig = { defaultDuration: 3 };
    const controller = makeControllerWith(dur3, [task({ path: 'start.md', start: new Date(2026, 7, 1) })]);
    await controller.init();
    const [inst] = await controller.getInstances();

    // No estimate → default duration 3 → inclusive span [Aug 1, Aug 3].
    expect(inst?.dateStatus).toBe('inferred-end');
    expect(inst?.end?.getDate()).toBe(3);
  });

  it('derivation includes every task regardless of date completeness (R1)', async () => {
    const controller = makeControllerWith(dur1, [
      task({ path: 'dateless.md' }),
      task({ path: 'due.md', end: AUG17 }),
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
    ]);
    await controller.init();
    expect(await controller.getInstances()).toHaveLength(3);
  });

  it('an undated multi-parent task still expands under every parent (R1)', async () => {
    // child is dateless; under the old derivation a hide-undated toggle dropped
    // BOTH placements. The derivation no longer drops — it expands under A and B.
    const controller = makeControllerWith(dur1, [
      task({ path: 'A.md', start: new Date(2026, 7, 1), end: AUG17 }),
      task({ path: 'B.md', start: new Date(2026, 7, 1), end: AUG17 }),
      task({ path: 'child.md', parents: ['A.md', 'B.md'] }),
    ]);
    await controller.init();
    const childInstances = (await controller.getInstances()).filter(
      (i) => i.sourcePath === 'child.md',
    );
    expect(childInstances).toHaveLength(2);
    expect(childInstances.every((i) => i.dateStatus === 'placeholder')).toBe(true);
  });

  it('an undated interior parent is retained with its dated child nested under it (R1)', async () => {
    // Old derivation hid the undated parent and reparented the child to root.
    // Now the parent stays and the child nests under it (KTD4: the view's filterTree
    // keeps an undated parent of a dated child anyway — R8's accepted behavior).
    const controller = makeControllerWith(dur1, [
      task({ path: 'parent.md' }), // undated → retained, not dropped
      task({ path: 'child.md', parents: ['parent.md'], end: AUG17 }),
    ]);
    await controller.init();
    const instances = await controller.getInstances();
    const child = instances.find((i) => i.sourcePath === 'child.md');

    expect(instances.map((i) => i.sourcePath).sort()).toEqual(['child.md', 'parent.md']);
    expect(child?.parent).toBeDefined(); // nested under the retained parent, NOT root
  });

  it('refreshes on a status-only change (comparator includes dateStatus)', async () => {
    // A task with only a due date resolves to [due, due] inferred-start (D=1).
    // Adding an equal start date keeps the SAME resolved dates but flips the
    // status to complete — the comparator must treat that as a change.
    const tn = new FakeSource({ tasks: [task({ path: 't.md', end: AUG17 })] });
    tn.enableSubscribe();
    const controller = new GanttController({
      app: fakeApp,
      basesInput: basesInputStub,
      policyConfig: dur1,
      now: () => FIXED_TODAY,
      deps: {
        createTaskNotesSource: async () => tn,
        createBasesSource: () => new FakeSource({}),
      },
    });
    await controller.init();
    expect((await controller.getInstances())[0]?.dateStatus).toBe('inferred-start');

    const listener = jest.fn();
    controller.onChange(listener);

    // start === end === AUG17 → resolved dates unchanged, dateStatus → complete.
    tn.tasks = [task({ path: 't.md', start: AUG17, end: AUG17 })];
    tn.fireChange();
    await flushAsync();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((await controller.getInstances())[0]?.dateStatus).toBe('complete');
  });
});

describe('GanttController — bases-scoped strategy (composite)', () => {
  /** A minimal BasesEntry stand-in (only `file.path` is read by fakes here). */
  const entry = (path: string): BasesEntry =>
    ({ file: { path } }) as unknown as BasesEntry;

  /**
   * Build a bases-scoped controller: the task set comes from `createBasesSource`
   * (the Base), and TaskNotes (`createTaskNotesSource`) is enrichment (deps +
   * capabilities), or absent. The real CompositeSource composes them.
   */
  function makeBasesScoped(opts: {
    baseTasks: SourceTask[];
    taskNotesPresent?: boolean;
    deps?: Record<string, SourceDependency[]>;
    write?: boolean;
  }): GanttController {
    const base = new FakeSource({ tasks: opts.baseTasks });
    const enrichment =
      opts.taskNotesPresent === false
        ? null
        : new FakeSource({ deps: opts.deps, write: opts.write });
    return new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => enrichment,
      },
    });
  }

  it('draws the task set from the Base and dependencies from TaskNotes', async () => {
    const controller = makeBasesScoped({
      baseTasks: [task({ path: 'pred.md' }), task({ path: 'dep.md' })],
      deps: { 'dep.md': [{ predecessorPath: 'pred.md', reltype: 'FINISHTOSTART', gap: null }] },
    });
    await controller.init();

    expect((await controller.getInstances()).map((i) => i.sourcePath).sort()).toEqual([
      'dep.md',
      'pred.md',
    ]);
    const links = await controller.getLinks('primary');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ source: 'pred.md', target: 'dep.md', type: 'e2s' });
  });

  it('resolves multi-parenting from the Base task set even with no TaskNotes', async () => {
    // The crux: parents come from the Base (TaskNotesSource exposes none), so
    // multi-parent duplication works in a Bases view independent of TaskNotes.
    const controller = makeBasesScoped({
      taskNotesPresent: false,
      baseTasks: [
        task({ path: 'A.md' }),
        task({ path: 'B.md' }),
        task({ path: 'child.md', parents: ['A.md', 'B.md'] }),
      ],
    });
    await controller.init();

    const child = (await controller.getInstances()).filter((i) => i.sourcePath === 'child.md');
    expect(child).toHaveLength(2);
    expect(child.every((i) => i.isVirtual)).toBe(true);
    expect(child.map((i) => i.parent).sort()).toEqual(['A.md', 'B.md']);
  });

  it('is read-only with no dependency links when TaskNotes is absent', async () => {
    const controller = makeBasesScoped({
      taskNotesPresent: false,
      baseTasks: [task({ path: 'a.md' })],
    });
    await controller.init();

    expect(controller.capabilities).toEqual({ write: false });
    expect(await controller.getLinks('primary')).toEqual([]);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['a.md']);
  });

  it('surfaces write capability from the TaskNotes enrichment (U8 forward-looking)', async () => {
    const controller = makeBasesScoped({ baseTasks: [task({ path: 'a.md' })], write: true });
    await controller.init();
    expect(controller.capabilities.write).toBe(true);
  });

  it('keeps the Base task set stable while TaskNotes availability flips capabilities', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'bs.md' })] });
    let tnReady = false;
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => (tnReady ? new FakeSource({ write: true }) : null),
      },
    });

    await controller.init();
    expect(controller.capabilities.write).toBe(false);
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['bs.md']);

    tnReady = true;
    await controller.onExternalSourceChange();
    expect(controller.capabilities.write).toBe(true);
    // The Base owns the set, so it is unchanged by the enrichment flip.
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['bs.md']);
  });

  it('re-reads the live Base entries on re-selection (Base filter changes take effect)', async () => {
    // The original bug: filtering the Base did not change the Gantt. Here the
    // Base drives the set, so a re-selection reflects the new entries.
    let entries: BasesEntry[] = [entry('a.md'), entry('b.md')];
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: () => ({ entries, mappings: {} as never }),
      deps: {
        createBasesSource: (_app, ents) =>
          new FakeSource({ tasks: ents.map((e) => task({ path: e.file.path })) }),
        createTaskNotesSource: async () => null,
      },
    });

    await controller.init();
    expect((await controller.getInstances()).map((i) => i.sourcePath).sort()).toEqual([
      'a.md',
      'b.md',
    ]);

    // User filters the Base down to a single entry.
    entries = [entry('a.md')];
    await controller.onExternalSourceChange();
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['a.md']);
  });

  it('refreshes dependency links when a TaskNotes change event fires', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'pred.md' }), task({ path: 'dep.md' })] });
    const enrichment = new FakeSource({ deps: {} });
    enrichment.enableSubscribe();
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => enrichment,
      },
    });

    await controller.init();
    expect(await controller.getLinks('primary')).toEqual([]);

    const listener = jest.fn();
    controller.onChange(listener);

    // A TaskNotes dependency appears; the subscribed event triggers a recompute.
    enrichment.deps = {
      'dep.md': [{ predecessorPath: 'pred.md', reltype: 'FINISHTOSTART', gap: null }],
    };
    enrichment.fireChange();
    await flushAsync();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await controller.getLinks('primary')).toHaveLength(1);
  });
});

describe('GanttController — getStatusColors', () => {
  it('returns the active source status-color palette', async () => {
    const colors = [{ value: '11🟥Active = Now', color: '#f8312f', isCompleted: false }];
    const src = {
      capabilities: { write: false },
      getTasks: async () => [],
      getDependencies: async () => [],
      getStatusColors: async () => colors,
    } as unknown as DataSource;
    const controller = new GanttController({
      app: fakeApp,
      basesInput: basesInputStub,
      deps: { createTaskNotesSource: async () => src, createBasesSource: () => new FakeSource({}) },
    });

    await controller.init();
    expect(await controller.getStatusColors()).toEqual(colors);
  });

  it('returns [] when the active source exposes no status colors', async () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({ tasks: [] }),
      createBasesSource: () => new FakeSource({}),
    });
    await controller.init();
    expect(await controller.getStatusColors()).toEqual([]);
  });

  it('returns [] before init (no active source)', async () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({}),
      createBasesSource: () => new FakeSource({}),
    });
    expect(await controller.getStatusColors()).toEqual([]);
  });
});

describe('GanttController — getPriorityColors', () => {
  it('returns the active source priority-color palette', async () => {
    const colors = [{ value: 'high', color: '#ff0000' }];
    const src = {
      capabilities: { write: false },
      getTasks: async () => [],
      getDependencies: async () => [],
      getPriorityColors: async () => colors,
    } as unknown as DataSource;
    const controller = new GanttController({
      app: fakeApp,
      basesInput: basesInputStub,
      deps: { createTaskNotesSource: async () => src, createBasesSource: () => new FakeSource({}) },
    });

    await controller.init();
    expect(await controller.getPriorityColors()).toEqual(colors);
  });

  it('returns [] when the active source exposes no priority colors', async () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({ tasks: [] }),
      createBasesSource: () => new FakeSource({}),
    });
    await controller.init();
    expect(await controller.getPriorityColors()).toEqual([]);
  });

  it('returns [] before init (no active source)', async () => {
    const controller = makeController({
      createTaskNotesSource: async () => new FakeSource({}),
      createBasesSource: () => new FakeSource({}),
    });
    expect(await controller.getPriorityColors()).toEqual([]);
  });
});

/** Flush pending microtasks so a fire-and-forget recompute can settle. */
async function flushAsync(): Promise<void> {
  // A macrotask boundary drains all pending microtasks first, so this settles
  // the controller's fire-and-forget recompute regardless of how many awaits
  // (getTasks + getDependencies per task) it chains internally.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GanttController — companion expansion stage (U4)', () => {
  /** Build a bases-scoped controller whose enrichment supports the companion reads. */
  function makeCompanion(opts: {
    baseTasks: SourceTask[];
    subtasks?: Record<string, SourceTask[]>;
    parents?: Record<string, string[]>;
    deps?: Record<string, SourceDependency[]>;
    mode?: 'inherit' | 'show-all';
  }): GanttController {
    const base = new FakeSource({ tasks: opts.baseTasks });
    const enrichment = new CompanionEnrichment({
      subtasks: opts.subtasks,
      parents: opts.parents,
      deps: opts.deps,
    });
    return new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({
        mode: opts.mode ?? 'inherit',
      }),
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => enrichment,
      },
    });
  }

  it('Show-all pulls transitive fetched descendants into the snapshot, flagged isFetched', async () => {
    const controller = makeCompanion({
      baseTasks: [task({ path: 'P.md' })],
      subtasks: { 'P.md': [task({ path: 'C.md' })], 'C.md': [task({ path: 'G.md' })] },
      parents: { 'C.md': ['P.md'], 'G.md': ['C.md'] },
      mode: 'show-all',
    });
    await controller.init();
    const instances = await controller.getInstances();
    expect(new Set(instances.map((i) => i.sourcePath))).toEqual(new Set(['P.md', 'C.md', 'G.md']));
    const fetched = instances.filter((i) => i.isFetched).map((i) => i.sourcePath);
    expect(new Set(fetched)).toEqual(new Set(['C.md', 'G.md']));
  });

  it('Inherit does not fetch out-of-result subtasks', async () => {
    const controller = makeCompanion({
      baseTasks: [task({ path: 'P.md' })],
      subtasks: { 'P.md': [task({ path: 'C.md' })] },
      parents: { 'C.md': ['P.md'] },
      mode: 'inherit',
    });
    await controller.init();
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['P.md']);
  });

  it('a matched child ALWAYS renders both at root (also-top-level duplicate) and nested — hide-top is a view filter, not a data change (#161)', async () => {
    const controller = makeCompanion({
      baseTasks: [task({ path: 'P.md' }), task({ path: 'C.md' })],
      parents: { 'C.md': ['P.md'] },
      mode: 'inherit',
    });
    await controller.init();
    const cInstances = (await controller.getInstances()).filter((i) => i.sourcePath === 'C.md');
    expect(cInstances.map((i) => i.id).sort()).toEqual(['C.md', 'C.md#parent-P.md']);
    // The duplicate root copy is FLAGGED so the view can hide it via filter-tasks;
    // the real nested copy is not. The instance SET is identical regardless of the
    // Hide-top toggle — that stability is what makes a config toggle unable to churn.
    expect(cInstances.find((i) => i.id === 'C.md')?.isTopLevelPlacement).toBe(true);
    expect(cInstances.find((i) => i.id === 'C.md#parent-P.md')?.isTopLevelPlacement).toBe(false);
  });

  it('resolves dependency edges for fetched (Show-all) descendants', async () => {
    const controller = makeCompanion({
      baseTasks: [task({ path: 'P.md' })],
      subtasks: { 'P.md': [task({ path: 'C.md' })] },
      parents: { 'C.md': ['P.md'] },
      // Fetched C is blocked by matched P; both endpoints have instances.
      deps: { 'C.md': [{ predecessorPath: 'P.md', reltype: 'FINISHTOSTART', gap: null }] },
      mode: 'show-all',
    });
    await controller.init();
    const links = await controller.getLinks('primary');
    expect(
      links.some((l) => l.source === 'P.md' && l.target.startsWith('C.md') && l.type === 'e2s'),
    ).toBe(true);
  });

  it('reads companion settings fresh each recompute (mode toggle applies without remount)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'P.md' })] });
    const enrichment = new CompanionEnrichment({
      subtasks: { 'P.md': [task({ path: 'C.md' })] },
      parents: { 'C.md': ['P.md'] },
    });
    const live = { mode: 'inherit' as 'inherit' | 'show-all' };
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: live.mode }),
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => enrichment,
      },
    });
    await controller.init();
    // Inherit → out-of-result subtasks stay out.
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['P.md']);

    // Flip the live setting and re-run selection (what onDataUpdated does): the
    // fresh read takes effect without a remount — Show-all now fetches C.
    live.mode = 'show-all';
    await controller.refreshSource();
    expect(new Set((await controller.getInstances()).map((i) => i.sourcePath))).toEqual(
      new Set(['P.md', 'C.md']),
    );
  });

  it('companion stage is inert in standalone mode (parents from the Base)', async () => {
    const base = new FakeSource({
      tasks: [task({ path: 'P.md' }), task({ path: 'C.md', parents: ['P.md'] })],
    });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => null,
      },
    });
    await controller.init();
    // No TaskNotes accessor → parents come from the Base; C nests under P, no
    // extra root, nothing flagged fetched.
    const instances = await controller.getInstances();
    expect(instances.filter((i) => i.sourcePath === 'C.md').map((i) => i.id)).toEqual([
      'C.md#parent-P.md',
    ]);
    expect(instances.every((i) => i.isFetched === false)).toBe(true);
  });
});

describe('GanttController — per-view settings freshness', () => {
  it('reads date-policy config fresh each recompute (defaultDuration change applies without remount)', async () => {
    // Only a start date → inferred-end bar whose span follows `defaultDuration`.
    const base = new FakeSource({ tasks: [task({ path: 'S.md', start: new Date(2026, 7, 1) })] });
    const policy = { defaultDuration: 1 };
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      policyConfig: () => ({ ...policy }),
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => null,
      },
    });
    await controller.init();
    const dayMs = 24 * 60 * 60 * 1000;
    const span1 = await controller.getInstances();
    // D=1 → single-day bar (start..end within the same day).
    expect(span1[0]!.end!.getTime() - span1[0]!.start!.getTime()).toBeLessThan(dayMs);

    // Widen the bar via a data-shaping change; a recompute re-reads it fresh (R6).
    policy.defaultDuration = 5;
    await controller.refreshSource();
    const span5 = await controller.getInstances();
    // D=5 → the inferred end now lands ~4 days after the start.
    expect(span5[0]!.end!.getTime() - span5[0]!.start!.getTime()).toBeGreaterThan(3 * dayMs);
  });

  it('still accepts a static policyConfig object (backward compatible)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'U.md' })] });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      policyConfig: { defaultDuration: 1 },
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => null,
      },
    });
    await controller.init();
    // The undated task is RETAINED (visibility is a view filter, not a derivation drop).
    expect((await controller.getInstances()).map((i) => i.sourcePath)).toEqual(['U.md']);
  });
});

describe('GanttController — source memoization + dependency batching (plan #161, U3)', () => {
  it('does NOT re-create the TaskNotes source across plain refreshes (availability unchanged)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const enrichment = new FakeSource({ deps: {} });
    const createTaskNotesSource = jest.fn(async () => enrichment as DataSource);
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: { createBasesSource: () => base, createTaskNotesSource },
    });

    await controller.init();
    await controller.refreshSource();
    await controller.refreshSource();

    // init + two refreshes, availability unchanged → resolved exactly once.
    expect(createTaskNotesSource).toHaveBeenCalledTimes(1);
  });

  it('re-creates the TaskNotes source after onExternalSourceChange (availability flip)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const createTaskNotesSource = jest.fn(async () => new FakeSource({ deps: {} }) as DataSource);
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: { createBasesSource: () => base, createTaskNotesSource },
    });

    await controller.init();
    expect(createTaskNotesSource).toHaveBeenCalledTimes(1);

    await controller.onExternalSourceChange();
    expect(createTaskNotesSource).toHaveBeenCalledTimes(2);
  });

  it('caches the relationship index across plain refreshes — never re-reads the full-vault index per Bases notify (#161 loop fix)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'P.md' }), task({ path: 'C.md' })] });
    const enrichment = new CompanionEnrichment({ parents: { 'C.md': ['P.md'] } });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'inherit' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });

    await controller.init();
    await controller.refreshSource();
    await controller.refreshSource();

    // init + two Bases-driven refreshes, no TaskNotes data-change → the
    // full-vault relationship index (api.tasks.list / getAllTasks) is read
    // exactly ONCE and reused. Re-reading it inside Bases' notify cycle is the
    // re-poke that drives the #161 infinite render loop.
    expect(enrichment.relationshipIndexCalls).toBe(1);
  });

  it('re-fetches the relationship index after a genuine TaskNotes data-change, then reuses it (cache invalidate + re-cache)', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'P.md' }), task({ path: 'C.md' })] });
    const enrichment = new CompanionEnrichment({ parents: { 'C.md': ['P.md'] } });
    enrichment.enableSubscribe();
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'inherit' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });

    await controller.init();
    expect(enrichment.relationshipIndexCalls).toBe(1);

    // A genuine TaskNotes change sets enrichmentDirty → the next build busts the
    // cache and re-reads the index, so fresh relationship data renders (the
    // correctness half of the fix: caching must not stale out real edits).
    enrichment.fireChange();
    await flushAsync();
    expect(enrichment.relationshipIndexCalls).toBe(2);

    // A subsequent plain Bases refresh rides the freshly-cached index again.
    await controller.refreshSource();
    expect(enrichment.relationshipIndexCalls).toBe(2);
  });

  it('does NOT cache a not-ready (null) relationship index; re-fetches until warm and heals Show-all (readiness bug)', async () => {
    // Base matches only the parent; the child is pulled in by Show-all from the
    // relationship index. While TaskNotes' metadataCache is cold the index is
    // not-ready (null) → no children pulled → Show-all stuck at matched-only.
    const base = new FakeSource({ tasks: [task({ path: 'P.md' })] });
    type RIndex = import('../../src/datasource/companionResolve').RelationshipIndex;
    const live: { index: RIndex | null } = { index: null };
    let calls = 0;
    const enrichment = {
      capabilities: { write: true },
      getTasks: async () => [],
      getDependencies: async () => [],
      getRelationshipIndex: async (): Promise<RIndex | null> => {
        calls += 1;
        return live.index;
      },
    } as unknown as DataSource;
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'show-all' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });

    await controller.init();
    // Cold: not-ready index → matched-only (no Show-all fetch).
    expect((await controller.getInstances()).map((i) => i.sourcePath).sort()).toEqual(['P.md']);
    expect(calls).toBe(1);

    // TaskNotes warms WITHOUT a data-change (no enrichmentDirty) — exactly the
    // case that never self-heals today (a warm-restart metadataCache load emits
    // no task.* event). A plain Bases refresh must re-fetch because the cold
    // result was never cached, and Show-all then pulls the child.
    live.index = {
      childrenByPath: new Map([['P.md', [task({ path: 'C.md' })]]]),
      parentsByPath: new Map([['C.md', ['P.md']]]),
    };
    await controller.refreshSource();

    expect(calls).toBe(2); // re-fetched: the cold (null) read was not cached
    expect((await controller.getInstances()).map((i) => i.sourcePath).sort()).toEqual([
      'C.md',
      'P.md',
    ]);

    // Once warm (non-null), the index IS cached — a further plain refresh reuses it.
    await controller.refreshSource();
    expect(calls).toBe(2);
  });

  it('caches a ready-but-empty relationship index — no re-fetch storm on a no-relationships vault', async () => {
    // A non-null index with empty maps is AUTHORITATIVE (TaskNotes is warm, the
    // vault just has no parent/child edges). It must be cached like any other
    // ready index — never re-read on each Bases notify (the full-vault scan is
    // the cost the #161 cache exists to avoid). This is the storm guard that a
    // naive "re-fetch whenever the index is empty" fix would violate.
    const base = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    let calls = 0;
    const enrichment = {
      capabilities: { write: true },
      getTasks: async () => [],
      getDependencies: async () => [],
      getRelationshipIndex: async () => {
        calls += 1;
        return { childrenByPath: new Map(), parentsByPath: new Map() };
      },
    } as unknown as DataSource;
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'show-all' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });

    await controller.init();
    await controller.refreshSource();
    await controller.refreshSource();

    expect(calls).toBe(1); // ready-but-empty is cached, not re-fetched per notify
  });

  it('re-reads field config / readiness each refresh even when the source is reused (cold→warm)', async () => {
    // A single memoized enrichment whose field config starts cold (null →
    // read-only) and warms to a resolvable config WITHOUT an availability event.
    const base = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const live: { fieldConfig: import('../../src/datasource/types').FieldConfig | null } = {
      fieldConfig: null,
    };
    const enrichment: DataSource = {
      capabilities: { write: true },
      getTasks: async () => [],
      getDependencies: async () => [],
      getFieldConfig: async () => live.fieldConfig,
    };
    const createTaskNotesSource = jest.fn(async () => enrichment);
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      deps: { createBasesSource: () => base, createTaskNotesSource },
    });

    await controller.init();
    // Cold cache: no resolvable field config → composite forced read-only (R-F).
    expect(controller.capabilities.write).toBe(false);

    // Cache warms (background indexing). A plain refresh re-reads getFieldConfig
    // from the SAME (memoized) source object — no re-create, but the warm config
    // is now observed and write is enabled.
    live.fieldConfig = { scheduledProp: 'scheduled', dueProp: 'due', dateFields: [] };
    await controller.refreshSource();
    expect(createTaskNotesSource).toHaveBeenCalledTimes(1); // still memoized
    expect(controller.capabilities.write).toBe(true);
  });

  it('resolves dependencies for all tasks via one batched pass (no N sequential awaits)', async () => {
    // Gate getDependencies so every call is pending simultaneously: if the
    // controller awaited them sequentially, only one would be in flight at a
    // time. Asserting all N are pending before any resolves proves concurrency.
    const tasks = [task({ path: 'a.md' }), task({ path: 'b.md' }), task({ path: 'c.md' })];
    const tn = new FakeSource({ tasks });
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    tn.getDependencies = () =>
      new Promise<SourceDependency[]>((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        resolvers.push(() => {
          inFlight -= 1;
          resolve([]);
        });
      });

    const controller = makeController({
      createTaskNotesSource: async () => tn,
      createBasesSource: () => new FakeSource({}),
    });

    const init = controller.init();
    // Let getTasks + the batched getDependencies dispatch settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(3); // all three dependency reads in flight at once
    resolvers.forEach((r) => r());
    await init;
  });
});

describe('GanttController — readiness re-check surface (U1 / #161 §11 relationship-lag)', () => {
  type RIndex = import('../../src/datasource/companionResolve').RelationshipIndex;

  /**
   * Build a bases-scoped controller whose enrichment is the given object, with a
   * `createTaskNotesSource` jest.fn so a test can assert the source is NOT
   * re-resolved on a readiness re-check (distinct from onExternalSourceChange).
   */
  function makeReadinessController(opts: {
    baseTasks: SourceTask[];
    enrichment: DataSource;
    createTaskNotesSource?: jest.Mock<(app: App) => Promise<DataSource | null>>;
    mode?: 'inherit' | 'show-all';
  }): {
    controller: GanttController;
    base: FakeSource;
    createTaskNotesSource: jest.Mock<(app: App) => Promise<DataSource | null>>;
  } {
    const base = new FakeSource({ tasks: opts.baseTasks });
    const createTaskNotesSource =
      opts.createTaskNotesSource ??
      (jest.fn(async () => opts.enrichment) as unknown as jest.Mock<
        (app: App) => Promise<DataSource | null>
      >);
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: opts.mode ?? 'show-all' }),
      deps: { createBasesSource: () => base, createTaskNotesSource },
    });
    return { controller, base, createTaskNotesSource };
  }

  it('recheckRelationshipIndex() re-fetches the index WITHOUT re-resolving the source or re-reading base entries (reuseTasks honored). Covers R7.', async () => {
    const enrichment = new CompanionEnrichment({ parents: { 'C.md': ['P.md'] } });
    const createTaskNotesSource = jest.fn(async () => enrichment) as unknown as jest.Mock<
      (app: App) => Promise<DataSource | null>
    >;
    const { controller, base } = makeReadinessController({
      baseTasks: [task({ path: 'P.md' }), task({ path: 'C.md' })],
      enrichment,
      createTaskNotesSource,
      mode: 'inherit',
    });

    await controller.init();
    expect(enrichment.relationshipIndexCalls).toBe(1);
    expect(base.getTasksCalls).toBe(1);
    expect(createTaskNotesSource).toHaveBeenCalledTimes(1);

    await controller.recheckRelationshipIndex();

    // Index re-fetched (cache busted via enrichmentDirty)…
    expect(enrichment.relationshipIndexCalls).toBe(2);
    // …but the base entries were NOT re-read (reuseTasks:true — the read #161's
    // storm fix avoids)…
    expect(base.getTasksCalls).toBe(1);
    // …and the TaskNotes source was NOT re-resolved (unlike onExternalSourceChange).
    expect(createTaskNotesSource).toHaveBeenCalledTimes(1);
  });

  it('two overlapping recheckRelationshipIndex() calls are latest-wins safe — a stale re-check resolving last does not clobber the newer readiness. Covers the recomputeSeq guard.', async () => {
    // Gate getRelationshipIndex so two overlapping re-checks can resolve out of
    // order. Call 1 returns a cold (no-matched-edge) index; call 2 returns a warm
    // (matched-edge) index. Resolving call 2 first then call 1 proves the stale
    // call 1 cannot overwrite the warm readiness.
    const resolvers: Array<(v: RIndex | null) => void> = [];
    const enrichment = {
      capabilities: { write: true },
      getTasks: async () => [],
      getDependencies: async () => [],
      getRelationshipIndex: () =>
        new Promise<RIndex | null>((resolve) => {
          resolvers.push(resolve);
        }),
    } as unknown as DataSource;
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'P.md' })],
      enrichment,
      mode: 'show-all',
    });

    // Settle init's first (gated) index read with a cold index.
    const init = controller.init();
    await flushAsync();
    resolvers.shift()!({ childrenByPath: new Map(), parentsByPath: new Map() });
    await init;
    expect(controller.readinessStatus().matchedEdgesResolved).toBe(false);

    // Two overlapping re-checks: both reach the gated index read.
    const r1 = controller.recheckRelationshipIndex();
    const r2 = controller.recheckRelationshipIndex();
    await flushAsync();
    expect(resolvers).toHaveLength(2);

    // Resolve the NEWER re-check (call 2) first with a warm index, then the older
    // (call 1) with a cold index. Latest-wins must keep the warm readiness.
    resolvers[1]!({
      childrenByPath: new Map([['P.md', [task({ path: 'C.md' })]]]),
      parentsByPath: new Map(),
    });
    resolvers[0]!({ childrenByPath: new Map(), parentsByPath: new Map() });
    await Promise.all([r1, r2]);

    expect(controller.readinessStatus().matchedEdgesResolved).toBe(true);
  });

  it('readinessStatus().matchedEdgesResolved is true when a matched parent has resolved children. Covers AE1.', async () => {
    const enrichment = new CompanionEnrichment({
      subtasks: { 'P.md': [task({ path: 'C.md' })] },
      parents: { 'C.md': ['P.md'] },
    });
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'P.md' })],
      enrichment,
      mode: 'show-all',
    });

    await controller.init();

    const status = controller.readinessStatus();
    expect(status.companionActive).toBe(true);
    expect(status.matchedEdgesResolved).toBe(true);
  });

  it('Show-all: matchedEdgesResolved is FALSE when a matched task has a resolved PARENT edge but its children are still cold — the signal must not early-stop on the wrong edge type (Codex review).', async () => {
    // Partial warmup: M.md's parent edge resolved (parentsByPath) but its children
    // (childrenByPath) have NOT. Show-all pulls descendants only from childrenByPath,
    // so reporting ready here would cache the partial index and leave M's children
    // absent. The Show-all signal must key on childrenByPath, not "any edge".
    const enrichment = new CompanionEnrichment({
      parents: { 'M.md': ['P.md'] }, // matched M's parent edge warmed…
      // …but no childrenByPath entry for M.md yet (children cold).
    });
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'M.md' })],
      enrichment,
      mode: 'show-all',
    });

    await controller.init();

    expect(controller.readinessStatus().matchedEdgesResolved).toBe(false);
  });

  it('Inherit: matchedEdgesResolved is true when a matched task has a resolved PARENT edge (the edge Inherit nesting consumes).', async () => {
    // Inherit nests displayed tasks via parentsByPath, so a matched task whose parent
    // resolved IS the warmed signal for Inherit (no childrenByPath needed).
    const enrichment = new CompanionEnrichment({
      parents: { 'C.md': ['P.md'] },
    });
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'C.md' })],
      enrichment,
      mode: 'inherit',
    });

    await controller.init();

    expect(controller.readinessStatus().matchedEdgesResolved).toBe(true);
  });

  it('readinessStatus().matchedEdgesResolved is false when only an UNMATCHED parent has children (matched parents still cold). Covers AE7.', async () => {
    // The Base matches A.md only; the index has edges for X.md (not matched).
    const enrichment = new CompanionEnrichment({
      subtasks: { 'X.md': [task({ path: 'Y.md' })] },
      parents: { 'Y.md': ['X.md'] },
    });
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'A.md' })],
      enrichment,
      mode: 'show-all',
    });

    await controller.init();

    expect(controller.readinessStatus().matchedEdgesResolved).toBe(false);
  });

  it('readinessStatus().matchedEdgesResolved is false on an all-empty index — never satisfied by emptiness. Covers AE7.', async () => {
    const enrichment = new CompanionEnrichment({});
    const { controller } = makeReadinessController({
      baseTasks: [task({ path: 'A.md' })],
      enrichment,
      mode: 'show-all',
    });

    await controller.init();

    expect(controller.readinessStatus().matchedEdgesResolved).toBe(false);
  });

  it('readinessStatus().matchedEdgesResolved is true for an EMPTY matched set — nothing to heal, so the window never starts.', async () => {
    // Companion mode active but the Base matches zero tasks. There are no matched
    // edges to wait for, so the signal must report resolved (vacuously) — otherwise
    // the readiness window would burn its full attempt cap re-scanning the vault for
    // a view that has nothing to expand.
    const enrichment = new CompanionEnrichment({
      subtasks: { 'P.md': [task({ path: 'C.md' })] },
    });
    const { controller } = makeReadinessController({
      baseTasks: [],
      enrichment,
      mode: 'show-all',
    });

    await controller.init();

    const status = controller.readinessStatus();
    expect(status.companionActive).toBe(true);
    expect(status.matchedEdgesResolved).toBe(true);
  });

  it('readinessStatus().companionActive is false in standalone (no enrichment / companionAccessor). Covers AE6.', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'a.md' })] });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'show-all' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => null },
    });

    await controller.init();

    const status = controller.readinessStatus();
    expect(status.companionActive).toBe(false);
    expect(status.matchedEdgesResolved).toBe(false);
  });
});

describe('GanttController — #161 dynamic resultset-change burst (P1 loop regression lock)', () => {
  /**
   * These replay the *dynamic* trigger of #161 as a composed SEQUENCE, not a
   * single guard in isolation: Bases fires `onDataUpdated` in a rapid burst
   * during a view-option persist+reload, and the persisted value oscillates
   * (`hideTop` read `true→true→false` across one toggle — bug report §6/§14).
   * The per-guard tests above each cover one brake (idempotent backstop, index
   * cache, fresh-config); this asserts the brakes COMPOSE so the burst can never
   * amplify into the loop, which is the property the static harness cannot see.
   *
   * Scope: this is the *controller half* of the loop (recompute/notify/refetch).
   * The Bases re-notify FEEDBACK itself (render → Bases notifies → render) lives
   * only in real Bases and is covered by the dynamic-trigger e2e — see
   * `match-harness-execution-model-to-bug-trigger.md`.
   */
  function makeBurstController() {
    const base = new FakeSource({ tasks: [task({ path: 'P.md' }), task({ path: 'C.md' })] });
    const enrichment = new CompanionEnrichment({ parents: { 'C.md': ['P.md'] } });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'inherit' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });
    return { controller, enrichment, base };
  }

  it('an arbitrarily long burst of identical Bases re-notifies neither re-fetches the full-vault index nor notifies (no amplification)', async () => {
    const { controller, enrichment } = makeBurstController();
    await controller.init();
    const listener = jest.fn();
    controller.onChange(listener);

    // The loop, distilled: Bases re-notifies many times with NOTHING changed.
    // refreshSource() is what onDataUpdated drives; firing it repeatedly must be
    // a no-op — zero re-fetch of the full-vault index (the re-poke), zero notify
    // (the re-render). The count of effects is bounded by the data, never by the
    // number of fires.
    for (let i = 0; i < 12; i += 1) await controller.refreshSource();

    expect(enrichment.relationshipIndexCalls).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a Hide-top toggle burst CANNOT change the instance set — the duplicate placement is invariant, so the chart cannot churn (#161 fix)', async () => {
    // The #161 churn came from Hide-top being baked into the instance derivation:
    // toggling it re-built a different instance array (390↔945) on every Bases
    // re-notify. Now Hide-top is a pure VIEW filter (filter-tasks), so the
    // controller's instance set is INVARIANT under the toggle. We prove that: many
    // refreshes (the documented oscillation, distilled — the controller no longer
    // even reads the toggle) produce the SAME instance set, emit ZERO change
    // notifications (idempotent), and never re-fetch the full-vault index. There is
    // nothing left for a config oscillation to churn.
    const { controller, enrichment } = makeBurstController();
    await controller.init();
    const snapshot = () =>
      controller.getInstances().then((xs) =>
        xs.filter((i) => i.sourcePath === 'C.md').map((i) => i.id).sort(),
      );
    const before = await snapshot();
    const listener = jest.fn();
    controller.onChange(listener);

    for (let i = 0; i < 6; i += 1) await controller.refreshSource();

    expect(await snapshot()).toEqual(before); // instance set unchanged across the burst
    expect(before).toEqual(['C.md', 'C.md#parent-P.md']); // duplicate placement always present
    expect(listener).not.toHaveBeenCalled(); // no transitions → no churn
    expect(enrichment.relationshipIndexCalls).toBe(1); // no re-poke
  });

  it('reuseTasks skips the Bases source re-read on a config-only refresh, yet still applies the config (#161 storm root-cause fix)', async () => {
    // ROOT CAUSE: re-reading the Bases source (source.getTasks() — extracting
    // every entry's values) on a config-only notify is what re-pokes Bases into
    // an endless onDataUpdated re-notify storm at scale. When the view knows the
    // entries are unchanged (same matched set), it passes reuseTasks:true so the
    // controller reuses the cached base tasks — no re-read, no re-poke — while
    // still re-running the (Bases-free) companion expansion against fresh config.
    const { controller, base } = makeBurstController();
    await controller.init();
    const callsAfterInit = base.getTasksCalls;
    expect(callsAfterInit).toBeGreaterThan(0); // init did a real read

    // Config-only refresh (entries unchanged) with reuseTasks → NO source re-read.
    await controller.refreshSource({ reuseTasks: true });
    expect(base.getTasksCalls).toBe(callsAfterInit); // getTasks NOT called again
    // …and the expansion still ran (companion-free): the full instance set is
    // produced (the also-top-level duplicate is always present — Hide-top is a view
    // filter applied downstream, not here).
    expect(
      (await controller.getInstances()).filter((i) => i.sourcePath === 'C.md').map((i) => i.id).sort(),
    ).toEqual(['C.md', 'C.md#parent-P.md']);

    // A genuine refresh (entries may have changed) re-reads as before.
    await controller.refreshSource({ reuseTasks: false });
    expect(base.getTasksCalls).toBeGreaterThan(callsAfterInit);
  });
});

describe('GanttController — default-view safe-partial interleave (U6/R7)', () => {
  /**
   * Build a bases-scoped, Show-all companion controller with a configurable
   * Base sort descriptor provider, so the R7 interleave wiring is exercised
   * end-to-end (resolveCompanionTree → positionFetchedAmongMatched → expand).
   */
  function makeSorted(opts: {
    baseTasks: SourceTask[];
    subtasks?: Record<string, SourceTask[]>;
    parents?: Record<string, string[]>;
    sortConfig: () => readonly import('obsidian').BasesSortConfig[];
  }): GanttController {
    const base = new FakeSource({ tasks: opts.baseTasks });
    const enrichment = new CompanionEnrichment({
      subtasks: opts.subtasks,
      parents: opts.parents,
    });
    return new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      // Explicitly map the fields the interleave keys on — the controller inverts
      // these (never a hardcoded property table), so the Base sort by `note.due`
      // resolves to the `end` field only because the test configures it as such.
      basesInput: () => ({
        entries: [],
        mappings: {
          textProperty: '',
          startProperty: 'note.scheduled',
          endProperty: 'note.due',
          statusProperty: 'note.status',
          progressProperty: 'note.progress',
        } as never,
      }),
      companionConfig: () => ({ mode: 'show-all' }),
      sortConfig: opts.sortConfig,
      deps: {
        createBasesSource: () => base,
        createTaskNotesSource: async () => enrichment,
      },
    });
  }

  it('interleaves a fetched child before a later matched sibling under the same parent (note.due ASC)', async () => {
    // P is the matched parent; matchedChild (due 03-10) is matched under P;
    // fetched (due 03-03) is pulled by Show-all under P → must precede matchedChild.
    const controller = makeSorted({
      baseTasks: [
        task({ path: 'P.md' }),
        task({ path: 'matched.md', end: new Date('2026-03-10'), parents: ['P.md'] }),
      ],
      subtasks: { 'P.md': [task({ path: 'fetched.md', end: new Date('2026-03-03') })] },
      parents: { 'matched.md': ['P.md'], 'fetched.md': ['P.md'] },
      sortConfig: () => [{ property: 'note.due' as never, direction: 'ASC' }],
    });
    await controller.init();
    // Children nested under P, in render order.
    const childOrder = (await controller.getInstances())
      .filter((i) => i.parent !== undefined)
      .map((i) => i.sourcePath);
    expect(childOrder).toEqual(['fetched.md', 'matched.md']);
  });

  it('keeps the matched-first fallback for an unmapped (formula) Base sort', async () => {
    const controller = makeSorted({
      baseTasks: [
        task({ path: 'P.md' }),
        task({ path: 'matched.md', end: new Date('2026-03-10'), parents: ['P.md'] }),
      ],
      subtasks: { 'P.md': [task({ path: 'fetched.md', end: new Date('2026-03-03') })] },
      parents: { 'matched.md': ['P.md'], 'fetched.md': ['P.md'] },
      sortConfig: () => [{ property: 'formula.daysLeft' as never, direction: 'ASC' }],
    });
    await controller.init();
    const childOrder = (await controller.getInstances())
      .filter((i) => i.parent !== undefined)
      .map((i) => i.sourcePath);
    // No positioning → fetched trails the matched sibling (discovery order).
    expect(childOrder).toEqual(['matched.md', 'fetched.md']);
  });

  it('reads the sort descriptor fresh each recompute (toolbar-sort change reflows without remount)', async () => {
    const live: { sort: import('obsidian').BasesSortConfig[] } = {
      sort: [{ property: 'formula.x' as never, direction: 'ASC' }],
    };
    const controller = makeSorted({
      baseTasks: [
        task({ path: 'P.md' }),
        task({ path: 'matched.md', end: new Date('2026-03-10'), parents: ['P.md'] }),
      ],
      subtasks: { 'P.md': [task({ path: 'fetched.md', end: new Date('2026-03-03') })] },
      parents: { 'matched.md': ['P.md'], 'fetched.md': ['P.md'] },
      sortConfig: () => live.sort,
    });
    await controller.init();
    const childOrderBefore = (await controller.getInstances())
      .filter((i) => i.parent !== undefined)
      .map((i) => i.sourcePath);
    expect(childOrderBefore).toEqual(['matched.md', 'fetched.md']);

    // Toolbar sort switches to note.due ASC → next recompute interleaves.
    live.sort = [{ property: 'note.due' as never, direction: 'ASC' }];
    await controller.refreshSource();
    const childOrderAfter = (await controller.getInstances())
      .filter((i) => i.parent !== undefined)
      .map((i) => i.sourcePath);
    expect(childOrderAfter).toEqual(['fetched.md', 'matched.md']);
  });

  it('defaults to the matched-first fallback when no sortConfig provider is given', async () => {
    const base = new FakeSource({ tasks: [task({ path: 'P.md' }), task({ path: 'matched.md', end: new Date('2026-03-10'), parents: ['P.md'] })] });
    const enrichment = new CompanionEnrichment({
      subtasks: { 'P.md': [task({ path: 'fetched.md', end: new Date('2026-03-03') })] },
      parents: { 'matched.md': ['P.md'], 'fetched.md': ['P.md'] },
    });
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: basesInputStub,
      companionConfig: () => ({ mode: 'show-all' }),
      deps: { createBasesSource: () => base, createTaskNotesSource: async () => enrichment },
    });
    await controller.init();
    const childOrder = (await controller.getInstances())
      .filter((i) => i.parent !== undefined)
      .map((i) => i.sourcePath);
    expect(childOrder).toEqual(['matched.md', 'fetched.md']);
  });
});

describe('computeRecomputeReason', () => {
  it('returns "noSnap" on the first build even when both other predicates are true', () => {
    // No prior snapshot short-circuits before snapshotChanged/writeChanged matter.
    expect(computeRecomputeReason(false, true, true)).toBe('noSnap');
  });

  it('returns "noSnap" on the first build even when both other predicates are false', () => {
    expect(computeRecomputeReason(false, false, false)).toBe('noSnap');
  });

  it('returns "notEqual" when the snapshot value changed', () => {
    expect(computeRecomputeReason(true, true, false)).toBe('notEqual');
  });

  it('returns "writeFlip" when only the write capability changed', () => {
    expect(computeRecomputeReason(true, false, true)).toBe('writeFlip');
  });

  it('returns "none" when neither the snapshot nor the write capability changed', () => {
    expect(computeRecomputeReason(true, false, false)).toBe('none');
  });

  it('prefers "notEqual" over "writeFlip" when both changed (precedence)', () => {
    expect(computeRecomputeReason(true, true, true)).toBe('notEqual');
  });
});

describe('buildSourceLinks', () => {
  it('flattens each task\'s blockedBy edges into predecessor → task links', () => {
    const tasks = [task({ path: 'a.md' }), task({ path: 'b.md' })];
    const links = buildSourceLinks(tasks, [
      [],
      [{ predecessorPath: 'a.md', reltype: 'FINISHTOSTART', gap: 'P1D' }],
    ]);
    expect(links).toEqual([
      { sourcePath: 'a.md', targetPath: 'b.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: 'P1D' },
    ]);
  });

  it('maps every reltype to its SVAR link type', () => {
    const tasks = [task({ path: 't.md' })];
    const links = buildSourceLinks(tasks, [
      [
        { predecessorPath: 'p1.md', reltype: 'FINISHTOSTART', gap: null },
        { predecessorPath: 'p2.md', reltype: 'STARTTOSTART', gap: null },
        { predecessorPath: 'p3.md', reltype: 'FINISHTOFINISH', gap: null },
        { predecessorPath: 'p4.md', reltype: 'STARTTOFINISH', gap: null },
      ],
    ]);
    expect(links.map((l) => l.type)).toEqual(['e2s', 's2s', 'e2e', 's2e']);
  });

  it('returns no links when no task has dependencies', () => {
    const tasks = [task({ path: 'a.md' }), task({ path: 'b.md' })];
    expect(buildSourceLinks(tasks, [[], []])).toEqual([]);
  });
});
