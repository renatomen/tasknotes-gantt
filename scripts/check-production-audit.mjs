/**
 * The production-dependency audit gate. It fails on every high or critical advisory
 * that `npm audit --omit=dev` reports for a package, except where that package and
 * advisory are both named in `production-audit-exceptions.json`. It also fails when
 * an exception no longer matches a reported advisory, so an entry is deleted as soon
 * as its fix lands and cannot outlive it.
 *
 *   node scripts/check-production-audit.mjs
 *
 * Exit 0: no unexcepted advisory. 1: findings. 2: the check could not run.
 *
 * @module scripts/check-production-audit
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = join(repoRoot, 'scripts/production-audit-exceptions.json');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * @typedef {object} AuditException
 * @property {string} advisory - GitHub advisory id, e.g. GHSA-xxxx-xxxx-xxxx
 * @property {string} package - the npm package the exception covers for that advisory
 * @property {string} recorded - the date the exception was agreed, YYYY-MM-DD
 * @property {string} reason - why the advisory cannot reach users
 * @property {string} removeWhen - the condition under which the entry goes
 */

/**
 * @typedef {object} AuditFinding
 * @property {string} advisory
 * @property {string} package
 * @property {string} severity
 * @property {string} title
 */

/**
 * @typedef {object} AuditResult
 * @property {AuditFinding[]} blocking - reported high or critical advisories without an exception for their package
 * @property {AuditException[]} stale - exceptions whose package no longer carries their advisory
 */

function advisoryId(url) {
  const match = /GHSA(?:-[a-z0-9]{4}){3}/i.exec(String(url ?? ''));
  return match ? match[0] : String(url ?? '');
}

function findingKey(packageName, advisory) {
  return `${packageName}\u0000${advisory}`;
}

function reportedAdvisories(report) {
  /** @type {Map<string, AuditFinding>} */
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const finding = {
        advisory: advisoryId(via.url),
        package: via.name ?? packageName,
        severity: via.severity,
        title: via.title,
      };
      const key = findingKey(finding.package, finding.advisory);
      if (!advisories.has(key)) advisories.set(key, finding);
    }
  }
  return advisories;
}

/**
 * Judge an `npm audit --json` report against the committed exceptions. An
 * exception covers one package for one advisory, never every package that
 * shares the advisory.
 *
 * @param {object} report - parsed `npm audit --omit=dev --json` output
 * @param {AuditException[]} exceptions
 * @returns {AuditResult}
 */
export function evaluateProductionAudit(report, exceptions) {
  const advisories = reportedAdvisories(report);
  const excepted = new Set(exceptions.map((entry) => findingKey(entry.package, entry.advisory)));
  const blocking = [...advisories.entries()]
    .filter(([key, finding]) => BLOCKING_SEVERITIES.has(finding.severity) && !excepted.has(key))
    .map(([, finding]) => finding);
  const stale = exceptions.filter((entry) => !advisories.has(findingKey(entry.package, entry.advisory)));
  return { blocking, stale };
}

/**
 * Parse `npm audit --json` output, refusing anything that is not an audit report.
 * npm exits non-zero both when it finds advisories and when the audit itself
 * fails, so the exit status cannot tell the two apart; the report's shape can.
 *
 * @param {string} text - raw stdout of `npm audit --omit=dev --json`
 * @returns {object} the parsed report
 */
export function parseAuditReport(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error(`npm audit output is not JSON: ${String(text).slice(0, 200)}`);
  }
  if (report?.error) {
    throw new Error(`npm audit failed: ${report.error.code ?? ''} ${report.error.summary ?? ''}`.trim());
  }
  if (typeof report?.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('npm audit output has no vulnerabilities object');
  }
  return report;
}

function runProductionAudit() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return parseAuditReport(result.stdout);
}

function main() {
  const exceptions = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'));
  const { blocking, stale } = evaluateProductionAudit(runProductionAudit(), exceptions);
  for (const finding of blocking) {
    console.error(`${finding.severity}: ${finding.advisory} in ${finding.package} — ${finding.title}`);
  }
  for (const entry of stale) {
    console.error(
      `stale exception: ${entry.advisory} is no longer reported for ${entry.package}; delete it from production-audit-exceptions.json`,
    );
  }
  const failed = blocking.length + stale.length > 0;
  if (!failed) console.log(`production audit clean (${exceptions.length} documented exception(s) in force)`);
  return failed ? 1 : 0;
}

const isDirectRun =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`Production audit check could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
