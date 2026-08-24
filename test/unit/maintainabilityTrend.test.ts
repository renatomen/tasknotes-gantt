/**
 * Pure-function coverage for the trend measurement (plan `2026-08-23-001` U3):
 * window math, table assembly, touched-line detection, at-ceiling counting,
 * report facts. Git output and the ESLint sweep are injected fixtures — the
 * real repo is never measured here (the CLI test owns end-to-end behavior in a
 * throwaway repository).
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atCeilingCount,
  churnShareLines,
  countRankedPrsSince,
  countWindowTouches,
  latestReport,
  parseArgs,
  parseCommitPaths,
  parseNumstat,
  perPrLines,
  runTrend,
  shouldRunAtCeiling,
} from '../../scripts/maintainability-trend.mjs';

describe('parseArgs', () => {
  it('parses every supported flag', () => {
    expect(
      parseArgs(['--base', 'b', '--head', 'h', '--registry', 'r.json', '--at-ceiling', '--eslint-json', 'e.json']),
    ).toEqual({
      base: 'b',
      head: 'h',
      registry: 'r.json',
      atCeiling: true,
      eslintJson: 'e.json',
    });
  });

  it('refuses an unknown argument by name', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument --bogus/);
  });

  it('refuses a valued flag with no value', () => {
    expect(() => parseArgs(['--base'])).toThrow(/--base needs a value/);
  });
});

describe('countWindowTouches', () => {
  it('counts one touch per path occurrence, skipping blank separators', () => {
    const output = 'src/a.ts\nsrc/b.ts\n\nsrc/a.ts\n\n';
    const touches = countWindowTouches(output);
    expect(touches.get('src/a.ts')).toBe(2);
    expect(touches.get('src/b.ts')).toBe(1);
    expect(touches.size).toBe(2);
  });
});

describe('churnShareLines', () => {
  const ranked = [{ path: 'src/ranked.ts', rank: 1 }];

  it('prints touches, percentage share, and the rank marker', () => {
    const touches = new Map([
      ['src/ranked.ts', 3],
      ['src/other.ts', 1],
    ]);
    const lines = churnShareLines(touches, 10, ranked);
    expect(lines[0]).toBe('  3 30.0% src/ranked.ts (rank 1)');
    expect(lines[1]).toBe('  1 10.0% src/other.ts');
  });

  it('always lists a ranked file, at zero touches, even outside the top rows', () => {
    const touches = new Map([['src/hot.ts', 5]]);
    const lines = churnShareLines(touches, 5, ranked);
    expect(lines).toContain('  0 0.0% src/ranked.ts (rank 1)');
  });

  it('reports n/a shares for an empty window instead of dividing by zero', () => {
    const lines = churnShareLines(new Map(), 0, ranked);
    expect(lines).toContain('  0 n/a src/ranked.ts (rank 1)');
  });
});

describe('parseNumstat', () => {
  it('parses added/removed counts per path and reads binary markers as zero', () => {
    const rows = parseNumstat('12\t3\tsrc/a.ts\n-\t-\tassets/img.png\n');
    expect(rows).toEqual([
      { path: 'src/a.ts', added: 12, removed: 3 },
      { path: 'assets/img.png', added: 0, removed: 0 },
    ]);
  });
});

describe('perPrLines', () => {
  const ranked = [
    { path: 'src/bases/GanttContainer.svelte', rank: 1 },
    { path: 'src/bases/register.ts', rank: 2 },
  ];

  it('prints the +/- counts and the cite-rank line for a touched ranked file', () => {
    const lines = perPrLines([{ path: 'src/bases/GanttContainer.svelte', added: 7, removed: 2 }], ranked);
    expect(lines).toEqual([
      '  +7/-2 src/bases/GanttContainer.svelte',
      '  ranked file touched — cite rank 1 in the PR description',
    ]);
  });

  it('reports zero ranked files touched when the diff misses the ranked set', () => {
    expect(perPrLines([{ path: 'docs/readme.md', added: 1, removed: 0 }], ranked)).toEqual([
      '  0 ranked files touched',
    ]);
  });
});

describe('shouldRunAtCeiling', () => {
  it('triggers on code-tree changes', () => {
    expect(shouldRunAtCeiling(['src/a.ts'])).toBe(true);
    expect(shouldRunAtCeiling(['test/unit/a.test.ts'])).toBe(true);
    expect(shouldRunAtCeiling(['scripts/x.mjs'])).toBe(true);
  });

  it('triggers on the sweep’s own inputs — lint config, registry, dependency manifests', () => {
    expect(shouldRunAtCeiling(['eslint.config.mjs'])).toBe(true);
    expect(shouldRunAtCeiling(['maintainability-registry.json'])).toBe(true);
    expect(shouldRunAtCeiling(['package.json'])).toBe(true);
    expect(shouldRunAtCeiling(['package-lock.json'])).toBe(true);
  });

  it('does not trigger on a docs-only change', () => {
    expect(shouldRunAtCeiling(['docs/plans/x.md', 'CONCEPTS.md'])).toBe(false);
  });
});

describe('atCeilingCount', () => {
  const message = (complexity: number) => ({
    ruleId: 'sonarjs/cognitive-complexity',
    message: `Refactor this function to reduce its Cognitive Complexity from ${complexity} to the 10 allowed.`,
  });

  it('counts only findings whose reported complexity equals the ceiling, not the pressure band', () => {
    const results = [
      { messages: [message(12), message(15)] },
      { messages: [message(15), { ruleId: 'no-unused-vars', message: 'x is unused' }] },
    ];
    expect(atCeilingCount(results)).toEqual({ bandTotal: 3, atCeiling: 2 });
  });

  it('counts nothing when the sweep reports only sub-ceiling findings', () => {
    expect(atCeilingCount([{ messages: [message(11), message(14)] }])).toEqual({
      bandTotal: 2,
      atCeiling: 0,
    });
  });
});

describe('latestReport', () => {
  it('returns the newest report by date', () => {
    const reports = [
      { date: '2026-08-16', report: 'docs/reports/2026-08-16-001.md' },
      { date: '2026-08-17', report: 'docs/reports/2026-08-17-001.md' },
    ];
    expect(latestReport(reports)?.date).toBe('2026-08-17');
  });

  it('breaks a same-date tie by the dated report path, so -002 beats -001', () => {
    const reports = [
      { date: '2026-08-17', report: 'docs/reports/2026-08-17-002-b.md' },
      { date: '2026-08-17', report: 'docs/reports/2026-08-17-001-a.md' },
    ];
    expect(latestReport(reports)?.report).toBe('docs/reports/2026-08-17-002-b.md');
  });

  it('returns null for an empty reports array', () => {
    expect(latestReport([])).toBeNull();
  });
});

describe('countRankedPrsSince', () => {
  const rankedPaths = new Set(['src/ranked.ts']);
  const reportPaths = new Set(['docs/reports/2026-08-17-002.md']);

  it('counts main-line commits touching a ranked file and ignores the rest', () => {
    const commits = parseCommitPaths(
      '@aaa\nsrc/ranked.ts\ndocs/other.md\n\n@bbb\ndocs/only.md\n\n@ccc\nsrc/ranked.ts\n',
    );
    expect(countRankedPrsSince(commits, rankedPaths, reportPaths)).toBe(2);
  });

  it('excludes a report-delivering commit even when it also touches a ranked file', () => {
    const commits = parseCommitPaths('@ddd\nsrc/ranked.ts\ndocs/reports/2026-08-17-002.md\n');
    expect(countRankedPrsSince(commits, rankedPaths, reportPaths)).toBe(0);
  });
});

describe('runTrend with injected git output and an injected ESLint runner', () => {
  let dir: string;

  const registryFixture = (baselineSha: string) => ({
    baseline: { sha: baselineSha, date: '2026-08-15', report: 'docs/reports/baseline.md' },
    rankedFiles: [{ path: 'src/ranked.ts', rank: 1 }],
    reports: [
      {
        date: '2026-08-17',
        anchorSha: 'b'.repeat(40),
        report: 'docs/reports/2026-08-17-002.md',
        concernCounts: { 'src/ranked.ts': 29 },
        atCeiling: 16,
      },
    ],
    boundary: {
      module: 'src/debugLog.ts',
      seamModule: 'src/bases/ganttLifecycleDiagnostics.ts',
      seamPublicNames: ['createGanttLifecycleDiagnostics'],
      allowedImportNames: ['dlog', 'isGanttDebugEnabled'],
      lifecycleGlobal: '__tnGanttLifecycle',
      files: [{ path: 'src/ranked.ts', globals: [] }],
      allowances: [
        {
          file: 'src/ranked.ts',
          importName: 'captureGanttLifecycle',
          dated: '2026-08-24',
          removedBy: 'U4',
          record: { delta: 'd', whyNotSeam: 'w', alternatives: 'a', approval: 'ok' },
        },
      ],
    },
  });

  const BASELINE = 'a'.repeat(40);
  const BASE = 'c'.repeat(40);
  const HEAD = 'd'.repeat(40);

  /** A fake git keyed on the sub-command; unexpected calls fail the test loudly. */
  const fakeGit =
    (overrides: Record<string, string | (() => string)> = {}) =>
    (args: string[]): string => {
      const key = args.join(' ');
      for (const [needle, value] of Object.entries(overrides)) {
        if (key.includes(needle)) return typeof value === 'function' ? value() : value;
      }
      if (args[0] === 'rev-parse') {
        const ref = args[args.length - 1].replace('^{commit}', '');
        return `${ref}\n`;
      }
      if (args[0] === 'cat-file') return '';
      if (args[0] === 'rev-list') return '4\n';
      if (args[0] === 'log' && key.includes('--name-only') && key.includes(`${BASELINE}..${BASE}`)) {
        return 'src/ranked.ts\nsrc/other.ts\nsrc/ranked.ts\n';
      }
      if (args[0] === 'log') return '';
      if (args[0] === 'show') return 'line1\nline2\n';
      if (args[0] === 'diff') return '';
      if (args[0] === 'merge-base') return `${BASE}\n`;
      throw new Error(`unexpected git call: ${key}`);
    };

  const writeRegistry = (registry: unknown): string => {
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify(registry));
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trend-unit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const run = (argv: string[], git = fakeGit(), runner: () => unknown[] = () => []) =>
    runTrend({ argv, runGit: git, makeEslintRunner: () => runner });

  it('records the window semantics in the header — baseline, merge-base end, head', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD]);
    expect(output).toContain(`window: ${BASELINE.slice(0, 9)}..${BASE.slice(0, 9)}`);
    expect(output).toContain(`base (merge-base): ${BASE}`);
    expect(output).toContain(`head: ${HEAD}`);
    expect(output).toContain("main-side ranked changes after the fork are measured by their own PRs’ artifacts");
  });

  it('assembles churn, size, and per-PR sections from the injected git output', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const git = fakeGit({
      [`diff --numstat --no-renames ${BASE}..${HEAD}`]: '5\t1\tsrc/ranked.ts\n',
    });
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD], git);
    expect(output).toContain('  2 50.0% src/ranked.ts (rank 1)');
    expect(output).toContain('  2 src/ranked.ts (rank 1)');
    expect(output).toContain('  +5/-1 src/ranked.ts');
    expect(output).toContain('ranked file touched — cite rank 1 in the PR description');
  });

  it('prints the latest report facts and the PRs-since count from the registry', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const git = fakeGit({
      [`${'b'.repeat(40)}..${BASE}`]: '@e1\nsrc/ranked.ts\n\n@e2\ndocs/x.md\n',
    });
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD], git);
    expect(output).toContain('Latest dated report: 2026-08-17 (docs/reports/2026-08-17-002.md)');
    expect(output).toContain('ranked.ts 29');
    expect(output).toContain('at-ceiling 16');
    expect(output).toMatch(/report-delivering commits excluded\): 1$/m);
  });

  it('marks the at-ceiling sweep CI-only when the flag is absent', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD]);
    expect(output).toContain('At-ceiling complexity count: not run — CI-only (--at-ceiling not passed)');
  });

  it('skips the sweep with the explicit marker when nothing it measures changed', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const git = fakeGit({
      [`diff --numstat --no-renames ${BASE}..${HEAD}`]: '1\t0\tdocs/plans/x.md\n',
    });
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD, '--at-ceiling'], git);
    expect(output).toContain('not run — no change to src/, test/, scripts/');
  });

  it('runs the injected sweep and prints only the at-ceiling count as the headline number', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const git = fakeGit({
      [`diff --numstat --no-renames ${BASE}..${HEAD}`]: '5\t1\tsrc/ranked.ts\n',
    });
    const runner = () => [
      {
        messages: [
          {
            ruleId: 'sonarjs/cognitive-complexity',
            message: 'Refactor this function to reduce its Cognitive Complexity from 12 to the 10 allowed.',
          },
          {
            ruleId: 'sonarjs/cognitive-complexity',
            message: 'Refactor this function to reduce its Cognitive Complexity from 15 to the 10 allowed.',
          },
        ],
      },
    ];
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', HEAD, '--at-ceiling'], git, runner);
    expect(output).toContain('At-ceiling complexity count (functions at exactly 15, from a threshold-10 sweep): 1');
    expect(output).toContain('pressure band 11–15 total findings: 2');
  });

  it('crashes with the fetch-depth hint when the baseline commit is unreachable', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const git = fakeGit({
      'cat-file': () => {
        throw new Error('missing object');
      },
    });
    await expect(run(['--registry', registryPath, '--base', BASE, '--head', HEAD], git)).rejects.toThrow(
      /fetch-depth: 0/,
    );
  });

  it('crashes naming the field when the registry is malformed', async () => {
    const registry = registryFixture(BASELINE) as { baseline: { sha: string } };
    registry.baseline.sha = 'not-a-sha';
    const registryPath = writeRegistry(registry);
    await expect(run(['--registry', registryPath, '--base', BASE, '--head', HEAD])).rejects.toThrow(
      /baseline\.sha/,
    );
  });

  it('reports an empty per-PR table when base and head are the same commit', async () => {
    const registryPath = writeRegistry(registryFixture(BASELINE));
    const output = await run(['--registry', registryPath, '--base', BASE, '--head', BASE]);
    expect(output).toContain('Per-PR ranked-file touches (empty range):');
    expect(output).toContain('  0 ranked files touched');
  });
});
