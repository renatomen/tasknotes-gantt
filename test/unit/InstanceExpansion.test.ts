import {
  expandInstances,
  DEFAULT_FANOUT_CAP,
  type RenderInstance,
  type SourceLink,
} from '../../src/controller/InstanceExpansion';
import type { SourceTask } from '../../src/datasource/types';

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

/** Find the single instance with the given id (asserting existence). */
function byId(instances: readonly RenderInstance[], id: string): RenderInstance {
  const found = instances.find((i) => i.id === id);
  if (!found) {
    throw new Error(`No instance with id "${id}". Got: ${instances.map((i) => i.id).join(', ')}`);
  }
  return found;
}

describe('expandInstances — ghost-run carry-through', () => {
  it('carries ghostRuns and stretchFlagged from the source task onto every instance', () => {
    const ghostRuns = [{ startDate: '2026-08-08', days: 2 }];
    const result = expandInstances([
      { ...task({ path: 'T.md' }), ghostRuns, stretchFlagged: true },
    ]);
    const instance = byId(result.instances, 'T.md');
    expect(instance.ghostRuns).toEqual(ghostRuns);
    expect(instance.stretchFlagged).toBe(true);
  });
});

describe('expandInstances — alsoTopLevel + isFetched (U4)', () => {
  it('alsoTopLevel adds a bare-path root instance in addition to the nested one', () => {
    const result = expandInstances([
      task({ path: 'P.md' }),
      { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true },
    ]);
    expect(result.getInstanceIds('C.md').sort()).toEqual(['C.md', 'C.md#parent-P.md']);
    expect(byId(result.instances, 'C.md').parent).toBeUndefined();
    expect(byId(result.instances, 'C.md#parent-P.md').parent).toBe('P.md');
  });

  it('without alsoTopLevel a child with a visible parent is nested only', () => {
    const result = expandInstances([
      task({ path: 'P.md' }),
      task({ path: 'C.md', parents: ['P.md'] }),
    ]);
    expect(result.getInstanceIds('C.md')).toEqual(['C.md#parent-P.md']);
  });

  it('alsoTopLevel does not double a task that has no visible parent (already root)', () => {
    const result = expandInstances([
      { ...task({ path: 'C.md', parents: ['missing.md'] }), alsoTopLevel: true },
    ]);
    expect(result.getInstanceIds('C.md')).toEqual(['C.md']);
  });

  it('children nest under the alsoTopLevel root instance too (subtree duplicated)', () => {
    const result = expandInstances([
      task({ path: 'P.md' }),
      { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true },
      task({ path: 'G.md', parents: ['C.md'] }),
    ]);
    expect(result.getInstanceIds('G.md').sort()).toEqual([
      'G.md#parent-C.md',
      'G.md#parent-C.md#parent-P.md',
    ]);
  });

  it('marks the alsoTopLevel root instance AND its whole subtree with isTopLevelPlacement (#161 display-filter)', () => {
    // hideTop becomes a VIEW filter over a stable instance set: the also-top-level
    // DUPLICATE placement (root copy + everything under it) is flagged so the view
    // can hide it via SVAR filter-tasks, without re-deriving the instance array.
    const result = expandInstances([
      task({ path: 'P.md' }),
      { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true },
      task({ path: 'G.md', parents: ['C.md'] }),
    ]);
    // Duplicate root placement + its subtree → flagged.
    expect(byId(result.instances, 'C.md').isTopLevelPlacement).toBe(true);
    expect(byId(result.instances, 'G.md#parent-C.md').isTopLevelPlacement).toBe(true);
    // The real nested copies → NOT flagged (these stay visible under hideTop).
    expect(byId(result.instances, 'C.md#parent-P.md').isTopLevelPlacement).toBe(false);
    expect(byId(result.instances, 'G.md#parent-C.md#parent-P.md').isTopLevelPlacement).toBe(false);
  });

  it('genuine root instances (a task with no visible parent) are NOT flagged isTopLevelPlacement', () => {
    const result = expandInstances([task({ path: 'R.md' })]);
    expect(byId(result.instances, 'R.md').isTopLevelPlacement).toBe(false);
  });

  it('carries isFetched onto every instance (defaults false)', () => {
    const result = expandInstances([
      { ...task({ path: 'F.md' }), isFetched: true },
      task({ path: 'M.md' }),
    ]);
    expect(byId(result.instances, 'F.md').isFetched).toBe(true);
    expect(byId(result.instances, 'M.md').isFetched).toBe(false);
  });
});

describe('expandInstances — root / single-parent cases', () => {
  it('0 visible parents → a single root instance whose id is the bare path', () => {
    const result = expandInstances([task({ path: 'root.md' })]);

    expect(result.instances).toHaveLength(1);
    const root = result.instances[0]!;
    expect(root.id).toBe('root.md');
    expect(root.sourcePath).toBe('root.md');
    expect(root.parent).toBeUndefined();
    expect(root.isVirtual).toBe(false);
    expect(root.isCollapsed).toBe(false);
  });

  it('1 visible parent → a single instance under that parent', () => {
    const tasks = [task({ path: 'p.md' }), task({ path: 'c.md', parents: ['p.md'] })];
    const result = expandInstances(tasks);

    const child = byId(result.instances, 'c.md#parent-p.md');
    expect(child.sourcePath).toBe('c.md');
    expect(child.parent).toBe('p.md');
    expect(child.isVirtual).toBe(false);
    expect(result.getInstanceIds('c.md')).toEqual(['c.md#parent-p.md']);
  });

  it('carries the task status onto instances (shared across multi-parent duplicates)', () => {
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'B.md' }),
      task({ path: 'c.md', parents: ['A.md', 'B.md'], status: '11🟥Active = Now' }),
    ];
    const result = expandInstances(tasks);

    const dups = result.instances.filter((i) => i.sourcePath === 'c.md');
    expect(dups).toHaveLength(2);
    expect(dups.every((i) => i.status === '11🟥Active = Now')).toBe(true);
    // A task with no status carries null.
    expect(byId(result.instances, 'A.md').status).toBeNull();
  });

  it('carries raw start/end/progress/text through to the instance', () => {
    const start = new Date('2026-04-02');
    const end = new Date('2026-04-20');
    const result = expandInstances([
      task({ path: 'r.md', text: 'Real Name', start, end, progress: 42 }),
    ]);

    const inst = result.instances[0]!;
    expect(inst.text).toBe('Real Name');
    expect(inst.start).toBe(start);
    expect(inst.end).toBe(end);
    expect(inst.progress).toBe(42);
  });
});

describe('expandInstances — visible-set filtering (AE6)', () => {
  it('parents [A,B,C] with only A,B visible → exactly two instances, none under C', () => {
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'B.md' }),
      // C.md intentionally absent from the visible set.
      task({ path: 'T.md', parents: ['A.md', 'B.md', 'C.md'] }),
    ];
    const result = expandInstances(tasks);

    const ids = result.getInstanceIds('T.md');
    expect(ids).toHaveLength(2);
    expect(ids).toContain('T.md#parent-A.md');
    expect(ids).toContain('T.md#parent-B.md');
    expect(ids.some((id) => id.includes('C.md'))).toBe(false);

    // >1 visible parent → virtual.
    for (const id of ids) {
      expect(byId(result.instances, id).isVirtual).toBe(true);
    }
  });

  it('all parents invisible → the task falls back to a single root instance', () => {
    const result = expandInstances([task({ path: 'T.md', parents: ['ghost.md'] })]);

    expect(result.getInstanceIds('T.md')).toEqual(['T.md']);
    expect(byId(result.instances, 'T.md').parent).toBeUndefined();
    expect(byId(result.instances, 'T.md').isVirtual).toBe(false);
  });
});

describe('expandInstances — nested multi-parent ancestry', () => {
  it("each child instance's parent is the correct parent INSTANCE id, which exists", () => {
    // R1, R2 roots; M multi-parented under both; C child of M.
    const tasks = [
      task({ path: 'R1.md' }),
      task({ path: 'R2.md' }),
      task({ path: 'M.md', parents: ['R1.md', 'R2.md'] }),
      task({ path: 'C.md', parents: ['M.md'] }),
    ];
    const result = expandInstances(tasks);

    // M has two instances.
    const mIds = result.getInstanceIds('M.md');
    expect(mIds.sort()).toEqual(['M.md#parent-R1.md', 'M.md#parent-R2.md']);

    // C has one instance per M instance, each parented to a concrete M instance id.
    const cIds = result.getInstanceIds('C.md');
    expect(cIds).toHaveLength(2);
    for (const cId of cIds) {
      const c = byId(result.instances, cId);
      expect(c.parent).toBeDefined();
      // The parent instance id must actually exist in the set.
      expect(result.getSourcePath(c.parent!)).toBe('M.md');
      expect(result.instances.some((i) => i.id === c.parent)).toBe(true);
      // The id embeds the full ancestry chain.
      expect(c.id).toBe(`C.md#parent-${c.parent}`);
    }
    // Concretely: grandchild ids chain the full ancestry.
    expect(cIds.sort()).toEqual([
      'C.md#parent-M.md#parent-R1.md',
      'C.md#parent-M.md#parent-R2.md',
    ]);
  });
});

describe('expandInstances — partial ancestry', () => {
  it('a multi-parented parent with one invisible grandparent → child only gets materialized ancestries', () => {
    // P is "multi-parented" by G1 (visible) and G2 (invisible).
    // P therefore materializes ONE instance (under G1). C must get exactly one
    // instance, parented to P's materialized instance — never dangling to G2.
    const tasks = [
      task({ path: 'G1.md' }),
      task({ path: 'P.md', parents: ['G1.md', 'G2.md'] }),
      task({ path: 'C.md', parents: ['P.md'] }),
    ];
    const result = expandInstances(tasks);

    expect(result.getInstanceIds('P.md')).toEqual(['P.md#parent-G1.md']);

    const cIds = result.getInstanceIds('C.md');
    expect(cIds).toEqual(['C.md#parent-P.md#parent-G1.md']);
    const c = byId(result.instances, cIds[0]!);
    expect(c.parent).toBe('P.md#parent-G1.md');
    expect(result.instances.some((i) => i.id === c.parent)).toBe(true);
    // Nothing dangles to the invisible G2 ancestry.
    expect(result.instances.some((i) => i.id.includes('G2.md'))).toBe(false);
  });
});

describe('expandInstances — identity maps round-trip', () => {
  it('instanceId→sourcePath resolves for every instance; sourcePath→instanceId[] returns all', () => {
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'B.md' }),
      task({ path: 'T.md', parents: ['A.md', 'B.md'] }),
    ];
    const result = expandInstances(tasks);

    // Forward map: every instance resolves to its source.
    for (const inst of result.instances) {
      expect(result.getSourcePath(inst.id)).toBe(inst.sourcePath);
    }

    // Reverse map: all instances of a duplicated task are returned.
    const tIds = result.getInstanceIds('T.md');
    expect(tIds).toHaveLength(2);
    for (const id of tIds) {
      expect(result.getSourcePath(id)).toBe('T.md');
    }

    // Primary is the first stable-sorted instance.
    expect(result.getPrimaryInstanceId('T.md')).toBe(tIds[0]);
  });

  it('unknown ids/paths resolve to undefined/empty rather than throwing', () => {
    const result = expandInstances([task({ path: 'a.md' })]);
    expect(result.getSourcePath('missing#parent-x')).toBeUndefined();
    expect(result.getInstanceIds('missing.md')).toEqual([]);
    expect(result.getPrimaryInstanceId('missing.md')).toBeUndefined();
  });
});

describe('expandInstances — cycle guard', () => {
  it('a direct cycle (A parent of B, B parent of A) terminates without infinite loop', () => {
    const tasks = [
      task({ path: 'A.md', parents: ['B.md'] }),
      task({ path: 'B.md', parents: ['A.md'] }),
    ];

    // The real assertion is that this returns at all (no stack overflow / hang).
    const result = expandInstances(tasks);

    // Both tasks produce at least one instance; nothing dangles.
    expect(result.getInstanceIds('A.md').length).toBeGreaterThan(0);
    expect(result.getInstanceIds('B.md').length).toBeGreaterThan(0);
    for (const inst of result.instances) {
      if (inst.parent !== undefined) {
        expect(result.instances.some((i) => i.id === inst.parent)).toBe(true);
      }
    }
  });

  it('a self-referential parent terminates and produces a root instance', () => {
    const result = expandInstances([task({ path: 'S.md', parents: ['S.md'] })]);
    expect(result.getInstanceIds('S.md')).toEqual(['S.md']);
    expect(byId(result.instances, 'S.md').parent).toBeUndefined();
  });
});

describe('expandInstances — fan-out guard', () => {
  it('a task exceeding the cap collapses to a single primary instance with indicator, never dropped', () => {
    const cap = 3;
    const parents = Array.from({ length: cap + 2 }, (_, i) => `P${i}.md`);
    const tasks: SourceTask[] = [
      ...parents.map((p) => task({ path: p })),
      task({ path: 'T.md', parents }),
    ];

    const result = expandInstances(tasks, { fanOutCap: cap });

    const tIds = result.getInstanceIds('T.md');
    // Collapsed to exactly one primary — never zero (no silent drop).
    expect(tIds).toHaveLength(1);
    const primary = byId(result.instances, tIds[0]!);
    expect(primary.isCollapsed).toBe(true);
    expect(result.wasCollapsed('T.md')).toBe(true);
    expect([...result.collapsedSourcePaths]).toContain('T.md');

    // The primary is the first stable-sorted ancestry (P0.md).
    expect(primary.id).toBe('T.md#parent-P0.md');
  });

  it('at or below the cap does not collapse', () => {
    const parents = Array.from({ length: DEFAULT_FANOUT_CAP }, (_, i) => `P${i}.md`);
    const tasks: SourceTask[] = [
      ...parents.map((p) => task({ path: p })),
      task({ path: 'T.md', parents }),
    ];
    const result = expandInstances(tasks);
    expect(result.getInstanceIds('T.md')).toHaveLength(DEFAULT_FANOUT_CAP);
    expect(result.wasCollapsed('T.md')).toBe(false);
  });
});

describe('expandInstances — delimiter safety', () => {
  it('a path containing "#" round-trips via the maps (identity is not string-split)', () => {
    const weird = 'weird#path.md';
    const tasks = [
      task({ path: weird }),
      task({ path: 'child.md', parents: [weird] }),
    ];
    const result = expandInstances(tasks);

    // The parent path with a literal "#" is a valid root instance.
    expect(result.getInstanceIds(weird)).toEqual([weird]);
    expect(result.getSourcePath(weird)).toBe(weird);

    // The child id embeds the "#"-containing parent id, yet identity still
    // resolves correctly through the explicit map (no mis-splitting).
    const childIds = result.getInstanceIds('child.md');
    expect(childIds).toEqual([`child.md#parent-${weird}`]);
    const child = byId(result.instances, childIds[0]!);
    expect(result.getSourcePath(child.id)).toBe('child.md');
    expect(child.parent).toBe(weird);
    expect(result.getSourcePath(child.parent!)).toBe(weird);
  });
});

describe('ExpansionResult.rewriteLinks', () => {
  function setup() {
    // B is multi-parented (two instances); A is a single root.
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'P1.md' }),
      task({ path: 'P2.md' }),
      task({ path: 'B.md', parents: ['P1.md', 'P2.md'] }),
    ];
    return expandInstances(tasks);
  }

  it("'primary' yields one link to the target's primary instance", () => {
    const result = setup();
    const links: SourceLink[] = [{ sourcePath: 'A.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];

    const rewritten = result.rewriteLinks(links, 'primary');
    expect(rewritten).toHaveLength(1);
    expect(rewritten[0]!.source).toBe('A.md');
    expect(rewritten[0]!.target).toBe(result.getPrimaryInstanceId('B.md'));
    expect(rewritten[0]!.type).toBe('e2s');
    expect(typeof rewritten[0]!.id).toBe('string');
    expect(rewritten[0]!.id.length).toBeGreaterThan(0);
  });

  it("'all' yields the cartesian product over both endpoints' instances", () => {
    const result = setup();
    const links: SourceLink[] = [{ sourcePath: 'A.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];

    const rewritten = result.rewriteLinks(links, 'all');
    // A has 1 instance, B has 2 → 2 links.
    expect(rewritten).toHaveLength(2);
    const targets = rewritten.map((l) => l.target).sort();
    expect(targets).toEqual(result.getInstanceIds('B.md').sort());
    for (const l of rewritten) {
      expect(l.source).toBe('A.md');
    }
  });

  it('drops links whose endpoint path has no instances', () => {
    const result = setup();
    const links: SourceLink[] = [
      { sourcePath: 'A.md', targetPath: 'ghost.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null },
      { sourcePath: 'ghost.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null },
    ];
    expect(result.rewriteLinks(links, 'primary')).toEqual([]);
    expect(result.rewriteLinks(links, 'all')).toEqual([]);
  });

  it('assigns stable, deterministic link ids (same input → same ids)', () => {
    const result = setup();
    const links: SourceLink[] = [{ sourcePath: 'A.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const a = result.rewriteLinks(links, 'all').map((l) => l.id);
    const b = result.rewriteLinks(links, 'all').map((l) => l.id);
    expect(a).toEqual(b);
    // Ids are unique within a rewrite.
    expect(new Set(a).size).toBe(a.length);
  });

  it('never produces an endpoint that is not a real instance id', () => {
    const result = setup();
    const links: SourceLink[] = [{ sourcePath: 'A.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const idSet = new Set(result.instances.map((i) => i.id));
    for (const l of result.rewriteLinks(links, 'all')) {
      expect(idSet.has(l.source)).toBe(true);
      expect(idSet.has(l.target)).toBe(true);
    }
  });

  it('carries reltype + gap through to the rewritten link (primary and all)', () => {
    const result = setup();
    const links: SourceLink[] = [
      { sourcePath: 'A.md', targetPath: 'B.md', type: 's2s', reltype: 'STARTTOSTART', gap: 'P1D' },
    ];
    for (const mode of ['primary', 'all'] as const) {
      for (const rw of result.rewriteLinks(links, mode)) {
        expect(rw.reltype).toBe('STARTTOSTART');
        expect(rw.gap).toBe('P1D');
        expect(rw.type).toBe('s2s');
      }
    }
  });

  it('a gap-only change yields a different link id (so diff-sync re-issues the link)', () => {
    const result = setup();
    const base: SourceLink = {
      sourcePath: 'A.md',
      targetPath: 'B.md',
      type: 'e2s',
      reltype: 'FINISHTOSTART',
      gap: null,
    };
    const [a] = result.rewriteLinks([base], 'primary');
    const [b] = result.rewriteLinks([{ ...base, gap: 'P1D' }], 'primary');
    expect(a!.id).not.toBe(b!.id);
  });

  it('preserves a null gap unchanged', () => {
    const result = setup();
    const links: SourceLink[] = [
      { sourcePath: 'A.md', targetPath: 'B.md', type: 'e2s', reltype: 'FINISHTOSTART', gap: null },
    ];
    expect(result.rewriteLinks(links, 'primary')[0]!.gap).toBeNull();
  });
});

describe('expandInstances — order follows input (Base sort) + determinism (U5)', () => {
  it('row order follows the input order, NOT path order (Base toolbar sort applies)', () => {
    // The Base hands data.data pre-sorted; the expander must preserve that order
    // rather than re-sorting on path (the old "Base sort does nothing" bug).
    const tasks = [task({ path: 'zebra.md' }), task({ path: 'apple.md' })];
    const ids = expandInstances(tasks).instances.map((i) => i.id);
    expect(ids).toEqual(['zebra.md', 'apple.md']); // input order, not ['apple','zebra']
  });

  it('children of a parent render in input (Base) order, not path order', () => {
    const tasks = [
      task({ path: 'P.md' }),
      task({ path: 'c-zzz.md', parents: ['P.md'] }),
      task({ path: 'c-aaa.md', parents: ['P.md'] }),
    ];
    const childOrder = expandInstances(tasks)
      .instances.filter((i) => i.parent === 'P.md')
      .map((i) => i.sourcePath);
    expect(childOrder).toEqual(['c-zzz.md', 'c-aaa.md']); // input order preserved
  });

  it('same input produces identical output (deterministic across re-renders)', () => {
    const tasks = [
      task({ path: 'A.md' }),
      task({ path: 'B.md' }),
      task({ path: 'T.md', parents: ['A.md', 'B.md'] }),
    ];
    const r1 = expandInstances(tasks).instances.map((i) => i.id);
    const r2 = expandInstances(tasks.map((t) => ({ ...t }))).instances.map((i) => i.id);
    expect(r1).toEqual(r2);
  });
});
