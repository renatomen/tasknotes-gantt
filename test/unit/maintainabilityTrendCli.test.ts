/**
 * The trend script's contract exercised through the real entry point against a
 * throwaway repository with a planted registry (`--registry`) — never against
 * this checkout, and never linting anything real (the sweep is injected via
 * `--eslint-json`).
 *
 * The repository graph is deliberately forked-behind-main: after the feature
 * branch forks, main gains a ranked-file commit the window must EXCLUDE
 * (window ends at the merge-base; main-side changes are measured by their own
 * PRs) while the registry facts count it as a ranked-file PR since the report.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/maintainability-trend.mjs');

jest.setTimeout(30_000);

// Children get a scrubbed env: inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE
// (e.g. under a git hook) would silently retarget the temp-repo git calls at
// the real repository.
const childEnv = { ...process.env };
delete childEnv.GIT_DIR;
delete childEnv.GIT_WORK_TREE;
delete childEnv.GIT_INDEX_FILE;

let root: string;
let repo: string;
let baselineSha: string;
let forkSha: string;
let mainTipSha: string;
let featureSha: string;
let registryPath: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: childEnv }).trim();
}

function commitFile(path: string, body: string, message: string): string {
  const full = join(repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(['add', path]);
  git(['commit', '-q', '--no-verify', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

function runScript(args: string[], cwd = repo): Run {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      env: childEnv,
    });
    return { status: 0, stdout: String(stdout), stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

const registryFixture = (baseline: string, reports: unknown[] = []) => ({
  baseline: { sha: baseline, date: '2026-08-15', report: 'docs/reports/baseline.md' },
  rankedFiles: [{ path: 'src/ranked.ts', rank: 1 }],
  reports,
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

function plantRegistry(registry: unknown): void {
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trend-cli-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  registryPath = join(root, 'registry.json');
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);

  baselineSha = commitFile('src/ranked.ts', 'export const a = 1;\n', 'baseline');
  forkSha = commitFile('src/carried.ts', 'export const b = 1;\n', 'carried work on main');
  git(['checkout', '-q', '-b', 'feature']);
  featureSha = commitFile('src/ranked.ts', 'export const a = 2;\n', 'feature touches the ranked file');
  git(['checkout', '-q', 'main']);
  // Main moves AFTER the fork: the window must not see this, the report facts must.
  mainTipSha = commitFile('src/ranked.ts', 'export const a = 3;\n', 'main-side ranked change');
  git(['checkout', '-q', 'feature']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('maintainability-trend CLI', () => {
  it('ends the window at the merge-base on a forked-behind-main graph, and says so in the header', () => {
    plantRegistry(registryFixture(baselineSha));
    const mergeBase = git(['merge-base', 'main', 'feature']);
    const run = runScript(['--registry', registryPath, '--base', mergeBase, '--head', featureSha]);
    expect(run.status).toBe(0);
    // Window baseline..fork holds exactly one commit (the carried work), which
    // does not touch the ranked file — neither the branch commit nor the
    // main-side change after the fork may leak into the churn table.
    expect(run.stdout).toContain('(1 window commits');
    expect(run.stdout).toContain('  0 0.0% src/ranked.ts (rank 1)');
    expect(run.stdout).toContain(`window: ${baselineSha.slice(0, 9)}..${mergeBase.slice(0, 9)}`);
    expect(run.stdout).toContain(`base (merge-base): ${mergeBase}`);
    expect(run.stdout).toContain(`head: ${featureSha}`);
    // The PR's own touch appears in the per-PR table with the reviewer prompt.
    expect(run.stdout).toContain('  +1/-1 src/ranked.ts');
    expect(run.stdout).toContain('ranked file touched — cite rank 1 in the PR description');
  });

  it('lists the diagnostics seam module beside the ranked sizes, absent-tolerant', () => {
    plantRegistry(registryFixture(baselineSha));
    const run = runScript(['--registry', registryPath]);
    expect(run.status).toBe(0);
    // The fixture repo never creates the seam path, so the size column reads
    // `absent` while the line itself is always present.
    expect(run.stdout).toMatch(/absent src\/bases\/ganttLifecycleDiagnostics\.ts \(diagnostics seam, unranked\)/);
  });

  it('defaults the range to merge-base(HEAD, main)..HEAD when no flags are given', () => {
    plantRegistry(registryFixture(baselineSha));
    // The planted registry lives outside the repo, so the default-registry read
    // would fail — the flag under test here is only the missing --base/--head.
    const run = runScript(['--registry', registryPath]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`base (merge-base): ${forkSha}`);
    expect(run.stdout).toContain(`head: ${featureSha}`);
    expect(run.stdout).toContain('ranked file touched — cite rank 1 in the PR description');
  });

  it('reports an empty per-PR table when run on main itself', () => {
    git(['checkout', '-q', 'main']);
    plantRegistry(registryFixture(baselineSha));
    const run = runScript(['--registry', registryPath]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Per-PR ranked-file touches (empty range):');
    expect(run.stdout).toContain('  0 ranked files touched');
  });

  it('covers AE6: a docs-only branch measures clean — no ranked touches, sweep not run', () => {
    git(['checkout', '-q', '-b', 'docs-only', 'main']);
    const docsHead = commitFile('docs/plans/x.md', 'plan\n', 'docs only');
    plantRegistry(registryFixture(baselineSha));
    const run = runScript(['--registry', registryPath, '--base', mainTipSha, '--head', docsHead, '--at-ceiling']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('  0 ranked files touched');
    expect(run.stdout).toContain('not run — no change to src/, test/, scripts/');
  });

  it('exits non-zero with the fetch-depth hint when the baseline commit is absent', () => {
    plantRegistry(registryFixture('f'.repeat(40)));
    const run = runScript(['--registry', registryPath]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fetch-depth: 0');
  });

  it('exits non-zero when the baseline is present but not an ancestor of the window end', () => {
    // The feature tip exists in the clone yet lies off the main history, so a
    // window ending at main would be silently empty instead of measured.
    plantRegistry(registryFixture(featureSha));
    const run = runScript(['--registry', registryPath, '--base', mainTipSha, '--head', mainTipSha]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not an ancestor of measurement endpoint');
    expect(run.stderr).toContain('baseline commit');
  });

  it("exits non-zero when the latest report's anchor is not an ancestor of the count's end", () => {
    plantRegistry(
      registryFixture(baselineSha, [
        { date: '2026-08-17', anchorSha: featureSha, report: 'docs/reports/older.md' },
      ]),
    );
    const mergeBase = git(['merge-base', 'main', 'feature']);
    const run = runScript(['--registry', registryPath, '--base', mergeBase, '--head', featureSha]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not an ancestor of measurement endpoint');
    expect(run.stderr).toContain("latest report's anchor");
  });

  it('exits non-zero naming the field on a malformed registry', () => {
    plantRegistry({ baseline: { sha: 'nope', date: 'x', report: 'r' } });
    const run = runScript(['--registry', registryPath]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('baseline.sha');
  });

  it('prints the latest report facts and counts ranked PRs since its anchor, excluding report-delivering commits', () => {
    git(['checkout', '-q', 'main']);
    // A commit that DELIVERS a registered dated report while touching the
    // ranked file: the count must skip it (the report already covers it).
    mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'reports', 'landed.md'), 'report\n');
    writeFileSync(join(repo, 'src', 'ranked.ts'), 'export const a = 4;\n');
    git(['add', '.']);
    git(['commit', '-q', '--no-verify', '-m', 'land the dated report with a ranked touch']);
    const reportLanding = git(['rev-parse', 'HEAD']);
    git(['checkout', '-q', 'feature']);
    plantRegistry(
      registryFixture(baselineSha, [
        { date: '2026-08-16', anchorSha: baselineSha, report: 'docs/reports/older.md' },
        {
          date: '2026-08-17',
          anchorSha: forkSha,
          report: 'docs/reports/landed.md',
          concernCounts: { 'src/ranked.ts': 29 },
          atCeiling: 16,
        },
      ]),
    );
    const run = runScript(['--registry', registryPath, '--base', reportLanding, '--head', featureSha]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Latest dated report: 2026-08-17 (docs/reports/landed.md) — ranked.ts 29; at-ceiling 16');
    // anchor(forkSha)..base holds the main-side ranked change (counted) and the
    // report-landing commit (excluded despite its ranked touch).
    expect(run.stdout).toMatch(/report-delivering commits excluded\): 1$/m);
  });

  it('counts only the at-ceiling finding from the injected sweep, not the sub-ceiling one', () => {
    plantRegistry(registryFixture(baselineSha));
    const fixture = join(root, 'eslint-results.json');
    const results = [
      {
        filePath: 'src/ranked.ts',
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
    writeFileSync(fixture, JSON.stringify(results));
    const mergeBase = git(['merge-base', 'main', 'feature']);
    const run = runScript([
      '--registry', registryPath,
      '--base', mergeBase,
      '--head', featureSha,
      '--at-ceiling',
      '--eslint-json', fixture,
    ]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('At-ceiling complexity count (functions at exactly 15, from a threshold-10 sweep): 1');
    expect(run.stdout).toContain('pressure band 11–15 total findings: 2');
  });

  it('exits non-zero with an actionable message when the injected sweep cannot run', () => {
    plantRegistry(registryFixture(baselineSha));
    const mergeBase = git(['merge-base', 'main', 'feature']);
    const run = runScript([
      '--registry', registryPath,
      '--base', mergeBase,
      '--head', featureSha,
      '--at-ceiling',
      '--eslint-json', join(root, 'does-not-exist.json'),
    ]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('at-ceiling ESLint sweep failed');
  });
});
