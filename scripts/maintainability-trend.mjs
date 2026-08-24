#!/usr/bin/env node
/**
 * Per-PR maintainability trend measurement — the pillar's instrument that no
 * plan can pause. Mirrors the baseline maintainability report's published
 * commands (the registry's `baseline.report` names it): windowed per-path
 * churn with `--no-renames`, ranked-file sizes, and the at-ceiling complexity
 * count, plus the per-PR ranked-file touch table and the registry's
 * dated-report facts.
 *
 * Measured values NEVER affect the exit code — the step is red only when the
 * measurement itself cannot run (shallow clone, malformed registry, failed
 * sub-command). The measurement window ends at the PR's merge-base with main:
 * main-side ranked changes after the fork are measured by their own PRs'
 * artifacts, and the header records both endpoints so staleness is visible.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readRegistry, validateRegistry } from './maintainability-registry.mjs';

export const CHURN_PATHSPEC = ['src', 'test', 'scripts'];
export const COMPLEXITY_CEILING = 15;
export const SWEEP_THRESHOLD = 10;
export const COMPLEXITY_RULE = 'sonarjs/cognitive-complexity';

/**
 * The at-ceiling sweep runs when the PR touches code — or any input of the
 * sweep itself (lint config, registry, ESLint/parser dependency set), so the
 * mechanism-changing PRs reviewers most need measured are never skipped.
 */
export const AT_CEILING_INPUT_FILES = [
  'eslint.config.mjs',
  'maintainability-registry.json',
  'package.json',
  'package-lock.json',
];

const AT_CEILING_NOT_TRIGGERED =
  `not run — no change to ${CHURN_PATHSPEC.map((dir) => dir + '/').join(', ')}, ` +
  `or the lint pass’s own inputs (${AT_CEILING_INPUT_FILES.join(', ')})`;

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`maintainability-trend: ${message}`);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { base: null, head: null, registry: null, atCeiling: false, eslintJson: null };
  const valued = { '--base': 'base', '--head': 'head', '--registry': 'registry', '--eslint-json': 'eslintJson' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--at-ceiling') {
      opts.atCeiling = true;
    } else if (arg in valued) {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      opts[valued[arg]] = value;
      i += 1;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  return opts;
}

/** Per-path touch counts from `git log --no-renames --format= --name-only` output. */
export function countWindowTouches(nameOnlyOutput) {
  const touches = new Map();
  for (const line of nameOnlyOutput.split('\n')) {
    const path = line.trim();
    if (path.length === 0) continue;
    touches.set(path, (touches.get(path) ?? 0) + 1);
  }
  return touches;
}

/** @param {{ path: string, rank: number }[]} rankedFiles */
function rankByPath(rankedFiles) {
  return new Map(rankedFiles.map((entry) => [entry.path, entry.rank]));
}

/**
 * The baseline report's churn-share table: every ranked file always shown,
 * plus the highest-churn unranked paths for context.
 *
 * @param {Map<string, number>} touches
 * @param {number} windowCommits
 * @param {{ path: string, rank: number }[]} rankedFiles
 * @param {number} [topN]
 */
export function churnShareLines(touches, windowCommits, rankedFiles, topN = 10) {
  const ranks = rankByPath(rankedFiles);
  const share = (count) =>
    windowCommits > 0 ? `${((count * 100) / windowCommits).toFixed(1)}%` : 'n/a';
  const row = (count, path) => {
    const rank = ranks.get(path);
    const rankSuffix = rank === undefined ? '' : ` (rank ${rank})`;
    return `  ${count} ${share(count)} ${path}${rankSuffix}`;
  };
  const sorted = [...touches.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = sorted.slice(0, topN).map(([path, count]) => row(count, path));
  for (const entry of rankedFiles) {
    const count = touches.get(entry.path) ?? 0;
    const alreadyShown = sorted.slice(0, topN).some(([path]) => path === entry.path);
    if (!alreadyShown) lines.push(row(count, entry.path));
  }
  return lines;
}

/** `git diff --numstat --no-renames` output into rows; binary counts read as 0. */
export function parseNumstat(numstatOutput) {
  const rows = [];
  for (const line of numstatOutput.split('\n')) {
    if (line.trim().length === 0) continue;
    const [added, removed, ...pathParts] = line.split('\t');
    rows.push({
      path: pathParts.join('\t'),
      added: Number.parseInt(added, 10) || 0,
      removed: Number.parseInt(removed, 10) || 0,
    });
  }
  return rows;
}

/**
 * The per-PR table: +/- per ranked file this PR touches, each with the
 * explicit reviewer prompt line the AGENTS.md invariant reads against.
 *
 * @param {{ path: string, added: number, removed: number }[]} numstatRows
 * @param {{ path: string, rank: number }[]} rankedFiles
 */
export function perPrLines(numstatRows, rankedFiles) {
  const ranks = rankByPath(rankedFiles);
  const lines = [];
  for (const row of numstatRows) {
    const rank = ranks.get(row.path);
    if (rank === undefined) continue;
    lines.push(
      `  +${row.added}/-${row.removed} ${row.path}`,
      `  ranked file touched — cite rank ${rank} in the PR description`,
    );
  }
  return lines.length > 0 ? lines : ['  0 ranked files touched'];
}

/** @param {string[]} changedPaths */
export function shouldRunAtCeiling(changedPaths) {
  const codePrefixes = CHURN_PATHSPEC.map((dir) => `${dir}/`);
  return changedPaths.some(
    (path) =>
      codePrefixes.some((prefix) => path.startsWith(prefix)) ||
      AT_CEILING_INPUT_FILES.includes(path),
  );
}

/**
 * Counts ONLY functions at the ceiling. A threshold-10 sweep fires the same
 * rule id for the whole 11–15 pressure band, so a rule-id count would report
 * the band as the at-ceiling number; the reported complexity in each message
 * is what discriminates.
 *
 * @param {{ messages?: { ruleId?: string | null, message?: string }[] }[]} eslintResults
 */
/**
 * The reported complexity of one sweep message, or null for other rules.
 * Crash-only-red applies to the parser too: a fatal (parse-failure) message
 * means part of the tree was never swept, and a reworded plugin message means
 * the value cannot be read — both must crash, never shade a count.
 */
function reportedComplexity(message, filePath) {
  if (message.fatal) {
    throw new Error(`the sweep could not lint ${filePath ?? 'a file'}: ${message.message}`);
  }
  if (message.ruleId !== COMPLEXITY_RULE) return null;
  const reported = /from (\d+) to the \d+ allowed/.exec(message.message ?? '');
  if (reported === null) {
    throw new Error(
      `cannot read the reported complexity from a ${COMPLEXITY_RULE} message ` +
        `("${message.message}") — the plugin's message format changed; update the parser`,
    );
  }
  return Number.parseInt(reported[1], 10);
}

export function atCeilingCount(eslintResults, ceiling = COMPLEXITY_CEILING) {
  const counts = { bandTotal: 0, atCeiling: 0, aboveCeiling: 0 };
  for (const result of eslintResults) {
    // Suppressed findings count too: an inline disable must not be able to
    // lower the published pressure numbers while the function is unchanged.
    const messages = [...(result.messages ?? []), ...(result.suppressedMessages ?? [])];
    for (const message of messages) {
      const value = reportedComplexity(message, result.filePath);
      if (value === null) continue;
      // A gate-failing PR can hold complexities above the ceiling (the trend
      // runs after failed gates); those are not the 11–15 pressure band.
      if (value > ceiling) {
        counts.aboveCeiling += 1;
      } else {
        counts.bandTotal += 1;
        if (value === ceiling) counts.atCeiling += 1;
      }
    }
  }
  return counts;
}

/**
 * Newest report by date; a same-day tie breaks on the dated report path, whose
 * `YYYY-MM-DD-NNN` naming makes the later sequence number sort last.
 *
 * @param {{ date: string, report: string }[]} reports
 */
export function latestReport(reports) {
  return reports.reduce(
    (latest, report) =>
      latest === null ||
      report.date > latest.date ||
      (report.date === latest.date && report.report > latest.report)
        ? report
        : latest,
    null,
  );
}

/** `git log --first-parent --no-renames --format=@%H --name-status` into per-commit path facts. */
export function parseCommitPaths(logOutput) {
  const commits = [];
  for (const line of logOutput.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('@')) {
      commits.push({ sha: trimmed.slice(1), paths: [], addedPaths: [] });
      continue;
    }
    const statusMatch = /^([A-Z])\S*\t(.+)$/.exec(trimmed);
    const current = commits.at(-1);
    if (statusMatch === null || current === undefined) continue;
    current.paths.push(statusMatch[2]);
    if (statusMatch[1] === 'A') current.addedPaths.push(statusMatch[2]);
  }
  return commits;
}

/**
 * "PRs since the latest report" = main-line commits after the report's anchor
 * that touch a ranked file — excluding any commit that ADDS a registered
 * dated report, so the report-landing PR itself is never counted as
 * unmeasured work (a report's own squash sha cannot be known while the report
 * is being written, so its recorded anchor may be its parent). Keyed on the
 * add, not any touch: a later PR that edits an old report while touching a
 * ranked file is still ranked work the count must show.
 *
 * @param {{ sha: string, paths: string[], addedPaths: string[] }[]} commits
 * @param {Set<string>} rankedPaths
 * @param {Set<string>} reportPaths
 */
export function countRankedPrsSince(commits, rankedPaths, reportPaths) {
  return commits.filter(
    (commit) =>
      commit.paths.some((path) => rankedPaths.has(path)) &&
      !commit.addedPaths.some((path) => reportPaths.has(path)),
  ).length;
}

/** @param {(args: string[]) => string} runGit */
function resolveCommit(runGit, ref, label) {
  try {
    return runGit(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  } catch {
    fail(`cannot resolve ${label} '${ref}' to a commit`);
  }
}

/** The current main tip — origin/main preferred — or null when neither resolves.
 * @param {(args: string[]) => string} runGit @returns {string | null} */
function resolveMainTip(runGit) {
  for (const candidate of ['origin/main', 'main']) {
    try {
      return runGit(['rev-parse', '--verify', `${candidate}^{commit}`]).trim();
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** @param {(args: string[]) => string} runGit */
function resolveRange(runGit, opts) {
  const head = resolveCommit(runGit, opts.head ?? 'HEAD', 'head');
  if (opts.base !== null) return { base: resolveCommit(runGit, opts.base, 'base'), head };
  const mainTip = resolveMainTip(runGit);
  if (mainTip === null) fail('no --base given and neither origin/main nor main resolves');
  try {
    return { base: runGit(['merge-base', mainTip, head]).trim(), head };
  } catch {
    fail(
      `cannot compute the merge-base of ${mainTip.slice(0, 9)} (main) and ${opts.head ?? 'HEAD'} — ` +
        'a shallow clone cannot walk to it; fetch full history (CI: fetch-depth: 0)',
    );
  }
}

/** @param {(args: string[]) => string} runGit */
function assertBaselineReachable(runGit, baselineSha) {
  try {
    runGit(['cat-file', '-e', `${baselineSha}^{commit}`]);
  } catch {
    fail(
      `baseline commit ${baselineSha.slice(0, 9)} is not in this clone — ` +
        'a shallow checkout cannot measure the window; fetch full history (CI: fetch-depth: 0)',
    );
  }
}

/** Line count matching split-on-newline semantics: an empty blob is one line. */
function countLines(body) {
  if (body.length === 0) return 1;
  let newlines = 0;
  for (const byte of body) {
    if (byte === 0x0a) newlines += 1;
  }
  return newlines + (body[body.length - 1] === 0x0a ? 0 : 1);
}

/**
 * Line counts from one `git cat-file --batch` output, in input order; null
 * marks a missing object. One spawn per ranked file was the hot cost of every
 * pre-push print, so all sizes ride a single batch call. Parsing is byte
 * based: the header's size field counts bytes, and slicing a decoded string
 * would break on multibyte content.
 *
 * @param {Buffer} output
 * @returns {(number | null)[]}
 */
export function parseCatFileBatchLineCounts(output) {
  const counts = [];
  let offset = 0;
  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const header = output.toString('utf8', offset, headerEnd);
    offset = headerEnd + 1;
    if (header.endsWith(' missing')) {
      counts.push(null);
      continue;
    }
    const size = Number.parseInt(header.split(' ')[2], 10);
    counts.push(countLines(output.subarray(offset, offset + size)));
    offset += size + 1;
  }
  return counts;
}

/** @param {(args: string[], input: string) => Buffer} runGitBuffer */
function rankedSizeLines(runGitBuffer, registry, head) {
  const specs = registry.rankedFiles.map((entry) => `${head}:${entry.path}`);
  const output = runGitBuffer(['cat-file', '--batch'], `${specs.join('\n')}\n`);
  const counts = parseCatFileBatchLineCounts(output);
  return registry.rankedFiles.map(
    (entry, index) => `  ${counts[index] ?? 'absent'} ${entry.path} (rank ${entry.rank})`,
  );
}

function windowSection(runGit, registry, base) {
  const baselineSha = registry.baseline.sha;
  const range = `${baselineSha}..${base}`;
  const windowCommits = Number.parseInt(runGit(['rev-list', '--count', range]).trim(), 10);
  const nameOnly = runGit([
    'log', '--no-renames', '--format=', '--name-only', range, '--', ...CHURN_PATHSPEC,
  ]);
  const touches = countWindowTouches(nameOnly);
  return [
    `Windowed churn share (${windowCommits} window commits, per-path touches over ${CHURN_PATHSPEC.join(' ')}, --no-renames):`,
    ...churnShareLines(touches, windowCommits, registry.rankedFiles),
  ];
}

async function atCeilingSection(opts, changedPaths, runEslint, runGit) {
  if (!opts.atCeiling) return ['At-ceiling complexity count: not run — CI-only (--at-ceiling not passed)'];
  if (!shouldRunAtCeiling(changedPaths)) {
    return [`At-ceiling complexity count: ${AT_CEILING_NOT_TRIGGERED}`];
  }
  let counts;
  try {
    counts = atCeilingCount(await runEslint());
  } catch (error) {
    fail(`at-ceiling ESLint sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The sweep lints the checked-out tree, which on a CI pull_request run is
  // the synthetic merge ref, not head — name it so a reviewer can explain a
  // mismatch against a locally measured number instead of distrusting both.
  const sweptTree = runGit(['rev-parse', 'HEAD']).trim();
  return [
    `At-ceiling complexity count (functions at exactly ${COMPLEXITY_CEILING}, from a threshold-${SWEEP_THRESHOLD} sweep): ${counts.atCeiling}`,
    `  pressure band ${SWEEP_THRESHOLD + 1}–${COMPLEXITY_CEILING} total findings: ${counts.bandTotal}`,
    ...(counts.aboveCeiling > 0
      ? [`  above the ceiling (a failing or suppressed complexity gate): ${counts.aboveCeiling}`]
      : []),
    `  swept tree: ${sweptTree}`,
  ];
}

function reportSection(runGit, registry, base) {
  const latest = latestReport(registry.reports);
  if (latest === null) return ['Latest dated report: none recorded in the registry'];
  const counts = latest.concernCounts
    ? Object.entries(latest.concernCounts)
        .map(([path, count]) => `${path.split('/').pop()} ${count}`)
        .join(', ')
    : 'no concern counts recorded';
  const atCeilingSuffix = latest.atCeiling === undefined ? '' : `; at-ceiling ${latest.atCeiling}`;
  const rankedPaths = new Set(registry.rankedFiles.map((entry) => entry.path));
  const reportPaths = new Set(registry.reports.map((report) => report.report));
  // A repo-state fact, not a per-PR one: the count runs to the CURRENT main
  // tip where one resolves, because ending at this branch's merge-base would
  // hide ranked-file PRs main merged after the fork.
  const end = resolveMainTip(runGit) ?? base;
  const log = runGit([
    'log', '--first-parent', '--no-renames', '--format=@%H', '--name-status',
    `${latest.anchorSha}..${end}`,
  ]);
  const since = countRankedPrsSince(parseCommitPaths(log), rankedPaths, reportPaths);
  return [
    `Latest dated report: ${latest.date} (${latest.report}) — ${counts}${atCeilingSuffix}`,
    `Ranked-file PRs merged since it (main-line commits after its anchor touching a ranked file, report-delivering commits excluded): ${since}`,
  ];
}

/**
 * @param {{ argv: string[], runGit: (args: string[]) => string,
 *   runGitBuffer: (args: string[], input: string) => Buffer,
 *   makeEslintRunner: (opts: ReturnType<typeof parseArgs>) => () => unknown[] | Promise<unknown[]> }} deps
 * @returns {Promise<string>} the full report text
 */
export async function runTrend({ argv, runGit, runGitBuffer, makeEslintRunner }) {
  const opts = parseArgs(argv);
  let registry;
  if (opts.registry !== null) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(opts.registry, 'utf8'));
    } catch (error) {
      fail(`cannot read registry ${opts.registry}: ${error instanceof Error ? error.message : String(error)}`);
    }
    registry = validateRegistry(parsed);
  } else {
    registry = readRegistry();
  }
  const { base, head } = resolveRange(runGit, opts);
  assertBaselineReachable(runGit, registry.baseline.sha);
  const numstat = base === head ? [] : parseNumstat(runGit(['diff', '--numstat', '--no-renames', `${base}..${head}`]));
  const rangeLabel = `${base.slice(0, 9)}..${head.slice(0, 9)}`;
  const atCeilingLines = await atCeilingSection(
    opts,
    numstat.map((row) => row.path),
    makeEslintRunner(opts),
    runGit,
  );
  const lines = [
    'Maintainability trend',
    `  baseline: ${registry.baseline.sha.slice(0, 9)} (${registry.baseline.date}, ${registry.baseline.report})`,
    `  window: ${registry.baseline.sha.slice(0, 9)}..${base.slice(0, 9)} (window ends at the PR's merge-base with main;`,
    '  main-side ranked changes after the fork are measured by their own PRs’ artifacts)',
    `  base (merge-base): ${base}`,
    `  head: ${head}`,
    '',
    ...windowSection(runGit, registry, base),
    '',
    'Ranked-file sizes at head (lines; informational — file length is not a gate, PR #355 ruling):',
    ...rankedSizeLines(runGitBuffer, registry, head),
    '',
    `Per-PR ranked-file touches (${base === head ? 'empty range' : rangeLabel}):`,
    ...perPrLines(numstat, registry.rankedFiles),
    '',
    ...atCeilingLines,
    '',
    ...reportSection(runGit, registry, base),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The real sweep runs through the ESLint API against the repo's own flat
 * config — the API equivalent of the baseline report's
 * `npx eslint . --rule` command. `--eslint-json` is the test seam: it reads a
 * planted results file so the CLI test never lints anything real.
 */
function defaultEslintRunner(opts) {
  if (opts.eslintJson !== null) {
    return () => JSON.parse(readFileSync(opts.eslintJson, 'utf8'));
  }
  return async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({
      overrideConfig: [{ rules: { [COMPLEXITY_RULE]: ['warn', SWEEP_THRESHOLD] } }],
    });
    return eslint.lintFiles(['.']);
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// No top-level await: jest imports this module under a CJS transform where
// only functions may await; the CLI path chains instead.
if (isDirectRun) {
  runTrend({
    argv: process.argv.slice(2),
    runGit: (args) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // Capture child stderr: probe calls (cat-file, rev-parse on absent
        // refs) fail by design, and their `fatal:` lines are not this
        // measurement's output.
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    runGitBuffer: (args, input) =>
      execFileSync('git', args, {
        input,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    makeEslintRunner: defaultEslintRunner,
  })
    .then((output) => process.stdout.write(output))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
