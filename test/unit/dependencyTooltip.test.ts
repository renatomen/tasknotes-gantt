import {
  dependencyTooltipModel,
  formatGap,
  formatIncomingDep,
  formatIncomingDeps,
  type IncomingDep,
} from '../../src/bases/dependencyTooltip';

const dep = (over: Partial<IncomingDep> = {}): IncomingDep => ({
  reltype: 'FINISHTOSTART',
  gap: null,
  predecessorName: 'Draft docs',
  linkId: 'L-a',
  ...over,
});

describe('formatGap', () => {
  it('formats single-unit durations compactly with a + sign', () => {
    expect(formatGap('P1D')).toBe('+1d');
    expect(formatGap('P3W')).toBe('+3w');
    expect(formatGap('PT4H')).toBe('+4h');
    expect(formatGap('PT30M')).toBe('+30m');
  });

  it('formats a lead (leading -) with a - sign', () => {
    expect(formatGap('-P2D')).toBe('-2d');
    expect(formatGap('-PT2H')).toBe('-2h');
  });

  it('returns empty string for null/empty', () => {
    expect(formatGap(null)).toBe('');
    expect(formatGap('')).toBe('');
    expect(formatGap('   ')).toBe('');
  });

  it('falls back to the raw ISO string for composite/exotic durations (KTD5)', () => {
    expect(formatGap('P1W2DT3H')).toBe('P1W2DT3H');
    expect(formatGap('P1Y')).toBe('P1Y');
    expect(formatGap('PT1H30M')).toBe('PT1H30M');
  });
});

describe('formatIncomingDep', () => {
  it('covers AE2 — FS edge with gap P1D shows FS and +1d', () => {
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOSTART', gap: 'P1D' }))).toBe(
      'Blocked by Draft docs — FS +1d',
    );
  });

  it('maps every reltype to its short label', () => {
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOSTART' }))).toContain('FS');
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOFINISH' }))).toContain('FF');
    expect(formatIncomingDep(dep({ reltype: 'STARTTOSTART' }))).toContain('SS');
    expect(formatIncomingDep(dep({ reltype: 'STARTTOFINISH' }))).toContain('SF');
  });

  it('omits the gap suffix when there is no gap', () => {
    expect(formatIncomingDep(dep({ reltype: 'STARTTOSTART', gap: null }))).toBe(
      'Blocked by Draft docs — SS',
    );
  });
});

describe('formatIncomingDeps', () => {
  it('returns empty string for no edges (caller must inject nothing)', () => {
    expect(formatIncomingDeps([])).toBe('');
  });

  it('lists each edge, sorted alphabetically by predecessor name (deterministic)', () => {
    const out = formatIncomingDeps([
      dep({ predecessorName: 'Zeta', reltype: 'STARTTOSTART' }),
      dep({ predecessorName: 'Alpha', reltype: 'FINISHTOSTART', gap: 'P1D' }),
    ]);
    expect(out).toBe('Blocked by Alpha — FS +1d\nBlocked by Zeta — SS');
  });
});

describe('dependencyTooltipModel', () => {
  it('reads the task through the wrapper the chart hands its tooltip content', () => {
    const model = dependencyTooltipModel({
      task: {
        text: 'Ship the release',
        custom: { incomingDeps: [dep({ predecessorName: 'Draft docs', gap: 'P1D' })] },
      },
      segmentIndex: null,
    });

    expect(model.title).toBe('Ship the release');
    expect(model.lines).toEqual(['Blocked by Draft docs — FS +1d']);
  });

  it('keeps the name and drops the dependency section when a task has no incoming edges', () => {
    const model = dependencyTooltipModel({ task: { text: 'Standalone', custom: {} } });

    expect(model.title).toBe('Standalone');
    expect(model.lines).toEqual([]);
  });

  it('yields an empty model for a payload that carries no task, such as a link tooltip', () => {
    expect(dependencyTooltipModel({ link: { id: 'l1' } })).toEqual({ title: '', lines: [] });
    expect(dependencyTooltipModel(undefined)).toEqual({ title: '', lines: [] });
  });
});

describe('dependencyTooltipModel — hovered dependency edge', () => {
  const task = (text: string, deps: IncomingDep[] = []) => ({ text, custom: { incomingDeps: deps } });

  it('names the blocked task and describes the one edge that was hovered', () => {
    const deps = [
      dep({ linkId: 'L-a', predecessorName: 'Draft docs', gap: 'P1D' }),
      dep({ linkId: 'L-b', predecessorName: 'Review copy', reltype: 'STARTTOSTART' }),
    ];
    const model = dependencyTooltipModel({ link: { id: 'L-b', target: 't' } }, (id) =>
      id === 't' ? task('Ship the release', deps) : null,
    );

    expect(model.title).toBe('Ship the release');
    expect(model.lines).toEqual(['Blocked by Review copy — SS']);
  });

  it('describes the hovered edge, not another edge from the same predecessor', () => {
    const deps = [
      dep({ linkId: 'L-a', predecessorName: 'Draft docs', reltype: 'FINISHTOSTART' }),
      dep({ linkId: 'L-b', predecessorName: 'Draft docs', reltype: 'STARTTOSTART', gap: 'P3W' }),
    ];
    const model = dependencyTooltipModel({ link: { id: 'L-b', target: 't' } }, () =>
      task('Ship the release', deps),
    );

    expect(model.lines).toEqual(['Blocked by Draft docs — SS +3w']);
  });

  it('distinguishes edges from predecessors that share a name', () => {
    const deps = [
      dep({ linkId: 'L-a', predecessorName: 'Review', gap: 'P1D' }),
      dep({ linkId: 'L-b', predecessorName: 'Review', gap: 'P3W' }),
    ];
    const model = dependencyTooltipModel({ link: { id: 'L-b', target: 't' } }, () =>
      task('Ship the release', deps),
    );

    expect(model.lines).toEqual(['Blocked by Review — FS +3w']);
  });

  it('yields an empty model when the hovered edge resolves to no known dependency', () => {
    expect(
      dependencyTooltipModel({ link: { id: 'L-gone', target: 't' } }, () =>
        task('Ship the release', [dep({ linkId: 'L-a' })]),
      ),
    ).toEqual({ title: '', lines: [] });
    expect(dependencyTooltipModel({ link: { id: 'L-b', target: 't' } })).toEqual({
      title: '',
      lines: [],
    });
  });
});
