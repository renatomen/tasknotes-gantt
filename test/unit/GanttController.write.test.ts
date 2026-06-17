/**
 * U8: GanttController write-path unit tests.
 *
 * Verifies the action layer's mutation surface against a writable+subscribable
 * fake source (no real Obsidian/TaskNotes):
 * - mutate(instanceId) resolves the instance → source path (U5 map) and calls
 *   the source's mutate once with a self MutationContext (correlationId).
 * - a multi-parent instance resolves to the single shared source path.
 * - read-only source / unknown instance → reject, no write attempted.
 * - echo control: a source event carrying the in-flight correlationId is
 *   suppressed (no notify) and removed on first match; an external event during
 *   the in-flight window IS processed (keyed on correlationId, not source===self);
 *   a self-event arriving after the TTL is processed (idempotent backstop covers it).
 * - a failed write clears the in-flight correlationId and propagates the error.
 * - deleteTask resolves + delegates with context.
 *
 * Following testing-standards.md: Jest, DI fakes, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { App } from 'obsidian';
import { GanttController } from '../../src/controller/GanttController';
import type { GanttControllerDeps } from '../../src/controller/GanttController';
import type {
  DataSource,
  DataSourceCapabilities,
  FieldConfig,
  MutationContext,
  SourceDependency,
  SourceTask,
  TaskPatch,
} from '../../src/datasource/types';
import { CompositeSource } from '../../src/datasource/CompositeSource';
import type { FieldMappings } from '../../src/bases/types/field-mapping';

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

/** Captured mutate call for assertions. */
interface MutateCall {
  path: string;
  patch: TaskPatch;
  context?: MutationContext;
}

/** A writable, subscribable fake source mirroring TaskNotes/Composite. */
class WritableFakeSource implements DataSource {
  public readonly capabilities: DataSourceCapabilities;
  public tasks: SourceTask[];
  public deps: Record<string, SourceDependency[]>;
  public mutateCalls: MutateCall[] = [];
  public deleteCalls: Array<{ path: string; context?: MutationContext }> = [];
  /** When set, mutate rejects with this error once. */
  public failNext: Error | null = null;
  /** The controller's change handler (receives eventName, payload). */
  public handler: ((eventName?: string, payload?: unknown) => void) | null = null;

  constructor(opts: { write?: boolean; tasks?: SourceTask[]; deps?: Record<string, SourceDependency[]> }) {
    this.capabilities = { write: opts.write ?? true };
    this.tasks = opts.tasks ?? [];
    this.deps = opts.deps ?? {};
  }

  async getTasks(): Promise<SourceTask[]> {
    return this.tasks;
  }

  async getDependencies(path: string): Promise<SourceDependency[]> {
    return this.deps[path] ?? [];
  }

  async mutate(path: string, patch: TaskPatch, context?: MutationContext): Promise<void> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.mutateCalls.push({ path, patch, context });
  }

  async deleteTask(path: string, context?: MutationContext): Promise<void> {
    this.deleteCalls.push({ path, context });
  }

  subscribe(handler: (eventName?: string, payload?: unknown) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  /** Simulate a TaskNotes change event with an optional payload. */
  fire(payload?: unknown): void {
    this.handler?.('task.updated', payload);
  }

  /** Field config exposed to the controller (bases-scoped resolution). */
  fieldConfig: FieldConfig | null = null;
  async getFieldConfig(): Promise<FieldConfig | null> {
    return this.fieldConfig;
  }
}

const fakeApp = {} as App;
const basesInputStub = () => ({ entries: [], mappings: {} as never });

/**
 * Flush enough microtasks for a fire-and-forget `recompute()` to settle (it
 * awaits getTasks + per-task getDependencies). Promises are not faked by jest's
 * fake timers, so this also works inside the TTL test.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/** Build a controller whose active source is the given writable fake. */
function makeController(
  source: DataSource,
  extra?: Partial<GanttControllerDeps>,
  options?: { correlationTtlMs?: number; newCorrelationId?: () => string },
): GanttController {
  const deps: GanttControllerDeps = {
    createTaskNotesSource: async () => source,
    createBasesSource: () => source,
    ...extra,
  };
  return new GanttController({
    app: fakeApp,
    basesInput: basesInputStub,
    deps,
    ...options,
  });
}

describe('GanttController.mutate — resolution + context', () => {
  it('resolves instanceId → source path and writes once with a self context', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, { newCorrelationId: () => `cid-${++n}` });
    await controller.init();

    // A single-parent task's instance id is the bare source path.
    await controller.mutate('a.md', { start: new Date(2026, 3, 2) });

    expect(src.mutateCalls).toHaveLength(1);
    const call = src.mutateCalls[0]!;
    expect(call.path).toBe('a.md');
    expect(call.patch).toEqual({ start: new Date(2026, 3, 2) });
    expect(call.context?.correlationId).toBe('cid-1');
    expect(call.context?.source).toBeTruthy();
  });

  it('resolves a multi-parent instance to the single shared source path (AE7)', async () => {
    // child under parents A and B → two instances, one source path.
    const src = new WritableFakeSource({
      tasks: [
        task({ path: 'A.md' }),
        task({ path: 'B.md' }),
        task({ path: 'child.md', parents: ['A.md', 'B.md'] }),
      ],
    });
    const controller = makeController(src);
    await controller.init();

    const instances = await controller.getInstances();
    const childInstances = instances.filter((i) => i.sourcePath === 'child.md');
    expect(childInstances.length).toBeGreaterThan(1); // duplicated

    // Dragging ONE instance writes to the single shared source path.
    await controller.mutate(childInstances[0]!.id, { end: new Date(2026, 3, 9) });

    expect(src.mutateCalls).toHaveLength(1);
    expect(src.mutateCalls[0]!.path).toBe('child.md');
  });

  it('rejects and does not write when the active source is read-only', async () => {
    const src = new WritableFakeSource({ write: false, tasks: [task({ path: 'a.md' })] });
    const controller = makeController(src);
    await controller.init();

    await expect(controller.mutate('a.md', { status: 'x' })).rejects.toThrow();
    expect(src.mutateCalls).toHaveLength(0);
  });

  it('rejects on an unknown instance id', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    const controller = makeController(src);
    await controller.init();

    await expect(controller.mutate('ghost.md', { status: 'x' })).rejects.toThrow();
    expect(src.mutateCalls).toHaveLength(0);
  });

  it('deleteTask resolves the path and delegates with a self context', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    const controller = makeController(src);
    await controller.init();

    await controller.deleteTask('a.md');

    expect(src.deleteCalls).toHaveLength(1);
    expect(src.deleteCalls[0]!.path).toBe('a.md');
    expect(src.deleteCalls[0]!.context?.correlationId).toBeTruthy();
  });
});

describe('GanttController.mutate — field-mapped writes (U3, bases-scoped)', () => {
  const fieldConfig: FieldConfig = {
    scheduledProp: 'scheduled',
    dueProp: 'due',
    dateFields: [{ key: 'start', id: 'uf_start', displayName: 'Start' }],
  };

  function makeBasesScoped(opts: {
    startProperty?: string;
    endProperty?: string;
    fieldConfig?: FieldConfig | null;
  }) {
    const base = new WritableFakeSource({ write: false, tasks: [task({ path: 'child.md' })] });
    const enrichment = new WritableFakeSource({ write: true });
    enrichment.fieldConfig = 'fieldConfig' in opts ? (opts.fieldConfig ?? null) : fieldConfig;
    let baseMappings: FieldMappings | undefined;
    const controller = new GanttController({
      app: fakeApp,
      sourceStrategy: 'bases-scoped',
      basesInput: () => ({
        entries: [],
        mappings: {
          startProperty: opts.startProperty,
          endProperty: opts.endProperty,
        } as FieldMappings,
      }),
      deps: {
        createTaskNotesSource: async () => enrichment,
        createBasesSource: (_app, _entries, mappings) => {
          baseMappings = mappings;
          return base;
        },
        createCompositeSource: (b, e) => new CompositeSource(b, e),
      },
    });
    return { controller, enrichment, getBaseMappings: () => baseMappings };
  }

  it('writes a start drag to the mapped custom date field, not scheduled (covers #70)', async () => {
    const { controller, enrichment } = makeBasesScoped({
      startProperty: 'note.start', // a custom date field key
      endProperty: 'note.due', // canonical due
    });
    await controller.init();

    await controller.mutate('child.md', { start: new Date(2026, 5, 1), end: new Date(2026, 6, 4) });

    expect(enrichment.mutateCalls).toHaveLength(1);
    expect(enrichment.mutateCalls[0]!.patch.dateWrites).toEqual([
      { target: { kind: 'userField', key: 'start', id: 'uf_start' }, value: new Date(2026, 5, 1) },
      { target: { kind: 'due' }, value: new Date(2026, 6, 4) },
    ]);
    // No raw start/end leak into the patch the source receives.
    expect(enrichment.mutateCalls[0]!.patch.start).toBeUndefined();
    expect(enrichment.mutateCalls[0]!.patch.end).toBeUndefined();
  });

  it('defaults an unmapped start/end to scheduled/due targets', async () => {
    const { controller, enrichment } = makeBasesScoped({}); // no overrides
    await controller.init();

    await controller.mutate('child.md', { start: new Date(2026, 5, 1) });

    expect(enrichment.mutateCalls[0]!.patch.dateWrites).toEqual([
      { target: { kind: 'scheduled' }, value: new Date(2026, 5, 1) },
    ]);
  });

  it('flags an invalid override and falls back to the default target symmetrically', async () => {
    const { controller, enrichment, getBaseMappings } = makeBasesScoped({
      startProperty: 'note.notes', // not scheduled/due nor a custom date field
    });
    await controller.init();

    // Invalid flag exposed for the view's notice.
    expect(controller.getDateMappingInfo().startInvalid).toBe(true);
    // Read mapping fell back to the default scheduled property (symmetry).
    expect(getBaseMappings()?.startProperty).toBe('note.scheduled');

    // And the write targets the default (scheduled), matching the read.
    await controller.mutate('child.md', { start: new Date(2026, 5, 1) });
    expect(enrichment.mutateCalls[0]!.patch.dateWrites).toEqual([
      { target: { kind: 'scheduled' }, value: new Date(2026, 5, 1) },
    ]);
  });

  it('feeds the resolved read property to the Bases source (valid custom field)', async () => {
    const { controller, getBaseMappings } = makeBasesScoped({ startProperty: 'note.start' });
    await controller.init();

    expect(getBaseMappings()?.startProperty).toBe('note.start');
    expect(controller.getDateMappingInfo().startInvalid).toBe(false);
  });

  it('falls back to legacy note.start/note.due read defaults when there is no field config (R-F)', async () => {
    const { controller, enrichment, getBaseMappings } = makeBasesScoped({ fieldConfig: null });
    await controller.init();

    // Read mapping uses the legacy defaults; no invalid flags.
    expect(getBaseMappings()?.startProperty).toBe('note.start');
    expect(getBaseMappings()?.endProperty).toBe('note.due');
    expect(controller.getDateMappingInfo()).toEqual({
      startInvalid: false,
      endInvalid: false,
      startReadProp: null,
      endReadProp: null,
    });

    // With no resolved targets, the write passes start/end through (the source
    // applies its canonical scheduled/due mapping).
    await controller.mutate('child.md', { start: new Date(2026, 5, 1) });
    expect(enrichment.mutateCalls[0]!.patch.start).toEqual(new Date(2026, 5, 1));
    expect(enrichment.mutateCalls[0]!.patch.dateWrites).toBeUndefined();
  });
});

describe('GanttController.mutate — echo control', () => {
  it('suppresses the self-write echo event (matching correlationId) — no notify', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, { newCorrelationId: () => `cid-${++n}` });
    await controller.init();
    const onChange = jest.fn();
    controller.onChange(onChange);

    await controller.mutate('a.md', { status: 'done' });
    // TaskNotes echoes the write back carrying our correlationId.
    src.fire({ correlationId: 'cid-1' });
    await flush();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('also recognizes the correlationId nested under context', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, { newCorrelationId: () => `cid-${++n}` });
    await controller.init();
    const onChange = jest.fn();
    controller.onChange(onChange);

    await controller.mutate('a.md', { status: 'done' });
    src.fire({ context: { correlationId: 'cid-1' } });
    await flush();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('processes an external event during an in-flight window (keyed on correlationId, not source)', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, { newCorrelationId: () => `cid-${++n}` });
    await controller.init();
    const onChange = jest.fn();
    controller.onChange(onChange);

    await controller.mutate('a.md', { status: 'done' });
    // A genuinely external edit (different/no correlationId) must NOT be swallowed.
    // Change the data so the recompute is a real (non-idempotent) change.
    src.tasks = [task({ path: 'a.md' }), task({ path: 'b.md' })];
    src.fire({ correlationId: 'someone-else' });
    await flush();

    expect(onChange).toHaveBeenCalled();
  });

  it('clears the in-flight correlationId on write failure (a later matching event is not suppressed)', async () => {
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, { newCorrelationId: () => `cid-${++n}` });
    await controller.init();
    const onChange = jest.fn();
    controller.onChange(onChange);

    src.failNext = new Error('write failed');
    await expect(controller.mutate('a.md', { status: 'x' })).rejects.toThrow('write failed');

    // The correlationId was never committed; an event reusing it is treated as
    // external. Make it a real change so a non-suppressed recompute notifies.
    src.tasks = [task({ path: 'a.md' }), task({ path: 'c.md' })];
    src.fire({ correlationId: 'cid-1' });
    await flush();

    expect(onChange).toHaveBeenCalled();
  });

  it('expires the in-flight correlationId after the TTL (late self-echo is processed)', async () => {
    // A real, tiny TTL avoids fake-timer/microtask interleaving complexity.
    const src = new WritableFakeSource({ tasks: [task({ path: 'a.md' })] });
    let n = 0;
    const controller = makeController(src, undefined, {
      correlationTtlMs: 5,
      newCorrelationId: () => `cid-${++n}`,
    });
    await controller.init();
    const onChange = jest.fn();
    controller.onChange(onChange);

    await controller.mutate('a.md', { status: 'done' });
    // Wait past the TTL so the correlationId is dropped from the in-flight set.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A late echo with the (now-expired) correlationId is treated as external;
    // make it a real change so we can observe the recompute notifying.
    src.tasks = [task({ path: 'a.md' }), task({ path: 'd.md' })];
    src.fire({ correlationId: 'cid-1' });
    await flush();

    expect(onChange).toHaveBeenCalled();
  });
});
