import type {
  DataSource,
  SourceTask,
  SourceDependency,
  TaskPatch,
  MutationContext,
} from '../../src/datasource';

/** Minimal read-only fake: declares write=false and omits the write methods. */
function makeReadOnlySource(tasks: SourceTask[]): DataSource {
  return {
    capabilities: { write: false },
    async getTasks() {
      return tasks;
    },
    async getDependencies() {
      return [];
    },
  };
}

/** Minimal write-capable fake: declares write=true and records mutations. */
function makeWriteSource(tasks: SourceTask[]) {
  const writes: Array<{ path: string; patch: TaskPatch; context?: MutationContext }> = [];
  const deletes: string[] = [];
  const source: DataSource = {
    capabilities: { write: true },
    async getTasks() {
      return tasks;
    },
    async getDependencies(): Promise<SourceDependency[]> {
      return [];
    },
    async mutate(path, patch, context) {
      writes.push({ path, patch, context });
    },
    async deleteTask(path) {
      deletes.push(path);
    },
  };
  return { source, writes, deletes };
}

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

describe('DataSource capability contract', () => {
  it('a read-only source reports write=false and omits write methods', () => {
    const source = makeReadOnlySource([]);
    expect(source.capabilities.write).toBe(false);
    expect(source.mutate).toBeUndefined();
    expect(source.deleteTask).toBeUndefined();
  });

  it('a write-capable source reports write=true and exposes write methods', async () => {
    const { source, writes, deletes } = makeWriteSource([]);
    expect(source.capabilities.write).toBe(true);
    expect(typeof source.mutate).toBe('function');
    expect(typeof source.deleteTask).toBe('function');

    const context: MutationContext = { source: 'obsidian-gantt', correlationId: 'c1' };
    await source.mutate!('a.md', { start: new Date('2026-03-01') }, context);
    await source.deleteTask!('b.md');

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('a.md');
    expect(writes[0]?.context?.correlationId).toBe('c1');
    expect(deletes).toEqual(['b.md']);
  });
});

describe('SourceTask shape', () => {
  it('supports no parents (root)', () => {
    const t = task({ path: 'root.md' });
    expect(t.parents).toEqual([]);
  });

  it('supports multiple resolved parent paths', () => {
    const t = task({ path: 'child.md', parents: ['a.md', 'b.md'] });
    expect(t.parents).toEqual(['a.md', 'b.md']);
  });

  it('carries null dates rather than formatted strings when unscheduled', () => {
    const t = task({ path: 'unscheduled.md' });
    expect(t.start).toBeNull();
    expect(t.end).toBeNull();
    expect(t.progress).toBeNull();
  });

  it('carries raw Date values when scheduled', () => {
    const start = new Date('2026-04-02');
    const end = new Date('2026-04-20');
    const t = task({ path: 'scheduled.md', start, end, progress: 50 });
    expect(t.start).toBe(start);
    expect(t.end).toBe(end);
    expect(t.progress).toBe(50);
  });
});
