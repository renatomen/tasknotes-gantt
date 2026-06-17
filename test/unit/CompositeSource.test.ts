/**
 * CompositeSource unit tests.
 *
 * Verifies the Bases-scoped-with-TaskNotes-enrichment composition:
 * - getTasks() always comes from the base (Bases) source.
 * - getDependencies() comes from the enrichment (TaskNotes) source, or [] when absent.
 * - capabilities reflect the enrichment, defaulting to read-only when absent.
 * - subscribe() delegates to the enrichment's subscribe (TaskNotes events), or a
 *   no-op disposer when the enrichment is absent or non-subscribable.
 *
 * Jest, DI fakes, AAA (testing-standards.md).
 */

import { describe, it, expect, jest } from '@jest/globals';
import { CompositeSource } from '../../src/datasource/CompositeSource';
import type {
  DataSource,
  DataSourceCapabilities,
  SourceDependency,
  SourceTask,
} from '../../src/datasource/types';

function task(path: string, parents: string[] = []): SourceTask {
  return { path, text: path, start: null, end: null, progress: null, status: null, parents };
}

/** A controllable fake source; subscription support is opt-in (mirrors TaskNotes). */
class FakeSource implements DataSource {
  public readonly capabilities: DataSourceCapabilities;
  public changeHandler: (() => void) | null = null;
  public unsubscribed = false;

  constructor(
    private readonly tasks: SourceTask[],
    private readonly deps: Record<string, SourceDependency[]> = {},
    write = false,
    subscribable = false,
  ) {
    this.capabilities = { write };
    if (subscribable) {
      this.subscribe = (handler: () => void) => {
        this.changeHandler = handler;
        return () => {
          this.unsubscribed = true;
          this.changeHandler = null;
        };
      };
    }
  }

  async getTasks(): Promise<SourceTask[]> {
    return this.tasks;
  }

  async getDependencies(path: string): Promise<SourceDependency[]> {
    return this.deps[path] ?? [];
  }

  subscribe?(handler: () => void): () => void;
}

describe('CompositeSource — task set', () => {
  it('reads the task set from the base source, never the enrichment', async () => {
    const base = new FakeSource([task('base.md', ['parent.md'])]);
    const enrichment = new FakeSource([task('enrich.md')]);
    const composite = new CompositeSource(base, enrichment);

    const tasks = await composite.getTasks();

    expect(tasks.map((t) => t.path)).toEqual(['base.md']);
    expect(tasks[0]?.parents).toEqual(['parent.md']);
  });

  it('still reads tasks from the base when there is no enrichment', async () => {
    const base = new FakeSource([task('base.md')]);
    const composite = new CompositeSource(base, null);

    expect((await composite.getTasks()).map((t) => t.path)).toEqual(['base.md']);
  });
});

describe('CompositeSource — dependencies', () => {
  it('reads dependencies from the enrichment source by path', async () => {
    const base = new FakeSource([task('pred.md'), task('dep.md')]);
    const enrichment = new FakeSource([], {
      'dep.md': [{ predecessorPath: 'pred.md', reltype: 'FINISHTOSTART', gap: null }],
    });
    const composite = new CompositeSource(base, enrichment);

    expect(await composite.getDependencies('dep.md')).toEqual([
      { predecessorPath: 'pred.md', reltype: 'FINISHTOSTART', gap: null },
    ]);
    expect(await composite.getDependencies('pred.md')).toEqual([]);
  });

  it('yields no dependencies when there is no enrichment (Bases has no dep model)', async () => {
    const composite = new CompositeSource(new FakeSource([task('a.md')]), null);

    expect(await composite.getDependencies('a.md')).toEqual([]);
  });
});

describe('CompositeSource — capabilities', () => {
  it('delegates capabilities to the enrichment source', () => {
    const writable = new CompositeSource(new FakeSource([]), new FakeSource([], {}, true));
    const readOnly = new CompositeSource(new FakeSource([]), new FakeSource([], {}, false));

    expect(writable.capabilities).toEqual({ write: true });
    expect(readOnly.capabilities).toEqual({ write: false });
  });

  it('is read-only when there is no enrichment', () => {
    expect(new CompositeSource(new FakeSource([]), null).capabilities).toEqual({ write: false });
  });
});

describe('CompositeSource — subscribe', () => {
  it('delegates subscription to the enrichment and forwards events', () => {
    const enrichment = new FakeSource([], {}, false, true);
    const composite = new CompositeSource(new FakeSource([]), enrichment);
    const handler = jest.fn();

    const dispose = composite.subscribe(handler);
    enrichment.changeHandler?.();
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
    expect(enrichment.unsubscribed).toBe(true);
  });

  it('returns a safe no-op disposer when the enrichment is absent', () => {
    const composite = new CompositeSource(new FakeSource([]), null);
    expect(() => composite.subscribe(jest.fn())()).not.toThrow();
  });

  it('returns a no-op disposer when the enrichment is not subscribable (bare Bases)', () => {
    // enrichment present but without a subscribe method (e.g. a second Bases source).
    const composite = new CompositeSource(new FakeSource([]), new FakeSource([]));
    expect(() => composite.subscribe(jest.fn())()).not.toThrow();
  });
});

describe('CompositeSource — status colors', () => {
  const colors = [{ value: '11🟥Active = Now', color: '#f8312f', isCompleted: false }];

  it('delegates getStatusColors to the enrichment', async () => {
    const enrichment = {
      capabilities: { write: false },
      getTasks: async () => [],
      getDependencies: async () => [],
      getStatusColors: async () => colors,
    } as unknown as DataSource;
    const composite = new CompositeSource(new FakeSource([]), enrichment);

    expect(await composite.getStatusColors()).toEqual(colors);
  });

  it('returns [] when there is no enrichment', async () => {
    const composite = new CompositeSource(new FakeSource([]), null);
    expect(await composite.getStatusColors()).toEqual([]);
  });

  it('returns [] when the enrichment exposes no getStatusColors', async () => {
    const composite = new CompositeSource(new FakeSource([]), new FakeSource([]));
    expect(await composite.getStatusColors()).toEqual([]);
  });
});
