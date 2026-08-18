#!/usr/bin/env node
/**
 * Aggregate per-leg e2e results from the repeat-run workflow into per-spec and
 * per-execution failure rates (reliability re-diagnosis, KTD5 leg validity).
 *
 *   node scripts/aggregate-e2e-results.mjs <downloaded-artifacts-dir>
 *
 * The directory is the target of `gh run download <run-id>` for ONE
 * e2e-repeat.yml run (attempt 1 only — re-run attempts mix artifact
 * generations): one `e2e-results-leg-<N>` subdirectory per leg, each holding
 * a `.wdio-results/` tree with per-session `wdio-<cid>-json-reporter.json`
 * files and the `wdio-merged-results.json` the launcher writes on completion.
 *
 * A leg counts toward the product denominator only if its merged file exists,
 * records exactly the expected spec count, and every session ran at least one
 * test; anything less is infrastructure-class and lands in the exclusion
 * report instead of the rate.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const EXPECTED_SPEC_COUNT = 39;

const LEG_ARTIFACT_PREFIX = 'e2e-results-leg-';
const MERGED_RESULTS_FILENAME = 'wdio-merged-results.json';
const SESSION_RESULTS_PATTERN = /^wdio-.+-json-reporter\.json$/;

/**
 * @typedef {{ passed: number, failed: number, skipped: number }} SessionState
 * @typedef {{ specs: string[], state: SessionState }} SessionResults
 * @typedef {{ leg: string, merged: { specs: string[] } | null, sessions: SessionResults[] }} LegResults
 * @typedef {'passed' | 'failed'} SpecOutcome
 * @typedef {{ leg: string, reason: string } & Record<string, unknown>} LegExclusion
 */

const specKeyFromUrl = (specUrl) => specUrl.split('/').pop();

function classifyLeg(leg, expectedSpecCount) {
  if (!leg.merged) {
    return { exclusion: { leg: leg.leg, reason: 'missing-merged-results' } };
  }
  const mergedSpecCount = new Set(leg.merged.specs.map(specKeyFromUrl)).size;
  if (mergedSpecCount !== expectedSpecCount) {
    return {
      exclusion: {
        leg: leg.leg,
        reason: 'unexpected-spec-count',
        recordedSpecCount: mergedSpecCount,
        expectedSpecCount,
      },
    };
  }
  return classifySessions(leg, expectedSpecCount);
}

function classifySessions(leg, expectedSpecCount) {
  const outcomes = new Map();
  for (const session of leg.sessions) {
    if (session.state.passed + session.state.failed === 0) {
      const spec = session.specs.map(specKeyFromUrl)[0] ?? null;
      return { exclusion: { leg: leg.leg, reason: 'zero-test-session', spec } };
    }
    for (const specUrl of session.specs) {
      const spec = specKeyFromUrl(specUrl);
      const failed = session.state.failed > 0 || outcomes.get(spec) === 'failed';
      outcomes.set(spec, failed ? 'failed' : 'passed');
    }
  }
  if (outcomes.size !== expectedSpecCount) {
    return {
      exclusion: {
        leg: leg.leg,
        reason: 'session-spec-mismatch',
        sessionSpecCount: outcomes.size,
        expectedSpecCount,
      },
    };
  }
  return { outcomes };
}

/**
 * @param {LegResults[]} legs
 * @param {{ expectedSpecCount: number }} options
 */
export function aggregateLegs(legs, { expectedSpecCount }) {
  /** @type {string[]} */
  const validLegs = [];
  /** @type {LegExclusion[]} */
  const excludedLegs = [];
  /** @type {Record<string, Record<string, SpecOutcome>>} */
  const matrix = {};
  let failingExecutions = 0;

  for (const leg of legs) {
    const { outcomes, exclusion } = classifyLeg(leg, expectedSpecCount);
    if (exclusion) {
      excludedLegs.push(exclusion);
      continue;
    }
    validLegs.push(leg.leg);
    let legFailed = false;
    for (const [spec, outcome] of outcomes) {
      (matrix[spec] ??= {})[leg.leg] = outcome;
      legFailed ||= outcome === 'failed';
    }
    if (legFailed) failingExecutions += 1;
  }

  const validLegCount = validLegs.length;
  /** @type {Record<string, { failures: number, rate: number }>} */
  const perSpecFailureRates = {};
  for (const [spec, outcomesByLeg] of Object.entries(matrix)) {
    const failures = Object.values(outcomesByLeg).filter((outcome) => outcome === 'failed').length;
    perSpecFailureRates[spec] = { failures, rate: failures / validLegCount };
  }

  return {
    validLegs,
    excludedLegs,
    matrix,
    perSpecFailureRates,
    perExecutionFailureRate: {
      failingExecutions,
      validLegCount,
      rate: validLegCount === 0 ? null : failingExecutions / validLegCount,
    },
  };
}

function findFilesRecursively(dir, matches) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFilesRecursively(entryPath, matches));
    else if (matches(entry.name)) found.push(entryPath);
  }
  return found;
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readLegsFromDirectory(artifactsDir) {
  const legDirNames = readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(LEG_ARTIFACT_PREFIX))
    .map((entry) => entry.name)
    .sort();
  return legDirNames.map((legDirName) => {
    const legDir = join(artifactsDir, legDirName);
    const mergedPath = findFilesRecursively(legDir, (name) => name === MERGED_RESULTS_FILENAME)[0];
    const sessionPaths = findFilesRecursively(legDir, (name) => SESSION_RESULTS_PATTERN.test(name));
    return {
      leg: legDirName,
      merged: mergedPath ? readJsonOrNull(mergedPath) : null,
      sessions: sessionPaths.map(readJsonOrNull).filter(Boolean),
    };
  });
}

const isDirectRun = process.argv[1]?.endsWith('aggregate-e2e-results.mjs');
if (isDirectRun) {
  const artifactsDir = process.argv[2];
  if (!artifactsDir) {
    console.error('usage: node scripts/aggregate-e2e-results.mjs <downloaded-artifacts-dir>');
    process.exit(1);
  }
  const legs = readLegsFromDirectory(artifactsDir);
  if (legs.length === 0) {
    console.error(`no ${LEG_ARTIFACT_PREFIX}* directories found under ${artifactsDir}`);
    process.exit(1);
  }
  console.log(JSON.stringify(aggregateLegs(legs, { expectedSpecCount: EXPECTED_SPEC_COUNT }), null, 2));
}
