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
import { GanttController } from '../../src/controller/GanttController';
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
import type { BasesEntry } from '../../src/bases/register';

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

describe('GanttController — date policy + visibility (U2)', () => {
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

  const showAll: DatePolicyConfig = {
    defaultDuration: 1,
    showUndatedTasks: true,
    showPartialDateTasks: true,
  };

  it('resolves a due-only task to its deadline, not today→due', async () => {
    const controller = makeControllerWith(showAll, [task({ path: 'due.md', end: AUG17 })]);
    await controller.init();
    const [inst] = await controller.getInstances();

    expect(inst?.dateStatus).toBe('inferred-start');
    // D=1 → single-day bar at the due date (August), NOT spanning from today (June).
    expect(inst?.start?.getMonth()).toBe(7);
    expect(inst?.start?.getDate()).toBe(17);
    expect(inst?.end?.getMonth()).toBe(7);
  });

  it('propagates dateStatus onto every RenderInstance', async () => {
    const controller = makeControllerWith(showAll, [
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
      task({ path: 'dateless.md' }),
    ]);
    await controller.init();
    const byPath = new Map((await controller.getInstances()).map((i) => [i.sourcePath, i]));

    expect(byPath.get('complete.md')?.dateStatus).toBe('complete');
    expect(byPath.get('dateless.md')?.dateStatus).toBe('placeholder');
  });

  it('hide-undated removes dateless tasks; partial + complete remain (AE5)', async () => {
    const controller = makeControllerWith(
      { ...showAll, showUndatedTasks: false },
      [
        task({ path: 'dateless.md' }),
        task({ path: 'due.md', end: AUG17 }),
        task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
      ],
    );
    await controller.init();
    const paths = (await controller.getInstances()).map((i) => i.sourcePath).sort();
    expect(paths).toEqual(['complete.md', 'due.md']);
  });

  it('hide-partial removes one-date tasks; complete + undated remain', async () => {
    const controller = makeControllerWith(
      { ...showAll, showPartialDateTasks: false },
      [
        task({ path: 'dateless.md' }),
        task({ path: 'due.md', end: AUG17 }),
        task({ path: 'start.md', start: new Date(2026, 7, 1) }),
        task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
      ],
    );
    await controller.init();
    const paths = (await controller.getInstances()).map((i) => i.sourcePath).sort();
    expect(paths).toEqual(['complete.md', 'dateless.md']);
  });

  it('default visibility shows every task regardless of date completeness (R7)', async () => {
    const controller = makeControllerWith(showAll, [
      task({ path: 'dateless.md' }),
      task({ path: 'due.md', end: AUG17 }),
      task({ path: 'complete.md', start: new Date(2026, 7, 1), end: AUG17 }),
    ]);
    await controller.init();
    expect(await controller.getInstances()).toHaveLength(3);
  });

  it('a hidden multi-parent task contributes no instances at all', async () => {
    // child is dateless and would normally render under both A and B.
    const controller = makeControllerWith(
      { ...showAll, showUndatedTasks: false },
      [
        task({ path: 'A.md', start: new Date(2026, 7, 1), end: AUG17 }),
        task({ path: 'B.md', start: new Date(2026, 7, 1), end: AUG17 }),
        task({ path: 'child.md', parents: ['A.md', 'B.md'] }),
      ],
    );
    await controller.init();
    const childInstances = (await controller.getInstances()).filter(
      (i) => i.sourcePath === 'child.md',
    );
    expect(childInstances).toHaveLength(0);
  });

  it('reparents children of a hidden interior parent to root (documented shadow path)', async () => {
    const controller = makeControllerWith(
      { ...showAll, showUndatedTasks: false },
      [
        task({ path: 'parent.md' }), // undated → hidden
        task({ path: 'child.md', parents: ['parent.md'], end: AUG17 }),
      ],
    );
    await controller.init();
    const instances = await controller.getInstances();
    const child = instances.find((i) => i.sourcePath === 'child.md');

    expect(instances.map((i) => i.sourcePath)).toEqual(['child.md']);
    expect(child?.parent).toBeUndefined(); // reparented to root
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
      policyConfig: showAll,
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

/** Flush pending microtasks so a fire-and-forget recompute can settle. */
async function flushAsync(): Promise<void> {
  // A macrotask boundary drains all pending microtasks first, so this settles
  // the controller's fire-and-forget recompute regardless of how many awaits
  // (getTasks + getDependencies per task) it chains internally.
  await new Promise((resolve) => setTimeout(resolve, 0));
}
